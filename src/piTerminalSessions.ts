import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  JsonLineDecoder,
  PI_BRIDGE_PROTOCOL_VERSION,
  type BridgeCommandAck,
  type BridgeConnectionStatus,
  type BridgeContextUsage,
  type BridgeHelloEvent,
  type BridgeMessageEvent,
  type BridgeRegistration,
  type BridgeSessionSnapshotEvent,
  type BridgeSessionState,
  type BridgeToQcodeMessage,
  type BridgeToolEvent,
  type BridgeUserInputEvent,
  type BridgeUserInputWait,
  type BridgeUserInputWaitEvent,
  encodeBridgeRecord,
  readBridgeRegistration,
  validateBridgeMessage,
} from "./piBridgeProtocol";
import {
  buildTerminalCommand,
  resolveTerminalShell,
  splitCliArgs,
  usesOpenAiCodexModelProvider,
} from "./shellCommand";
import {
  collapseSkillContent,
  countMatchingUserMessages,
  createThinkingMessage,
  getToolThinkingKey,
  isSessionFile,
  normalizeUserMessageText,
  readActivatedSkillName,
  readSessionDetail,
  readSessionMessagesFromContent,
  userMessageTextsMatch,
  type ContextUsage,
  type SessionMessage,
} from "./sessionFiles";

const COMMAND_TIMEOUT_MS = 10_000;
const REGISTRATION_SCAN_INTERVAL_MS = 1_000;
const BRIDGE_STARTUP_TIMEOUT_MS = 15_000;

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface OptimisticUserMessage {
  clientMessageId: string;
  text: string;
  baselineOccurrenceCount: number;
  preSendLeafId?: string | null;
  preSendSequence: number;
  deliveryState: "pending" | "accepted" | "correlated" | "failed";
  authoritativeText?: string;
  authoritativeEntryId?: string;
}

interface ManagedSession {
  bridgeId: string;
  token: string;
  registrationPath: string;
  terminal?: vscode.Terminal;
  terminalExited: boolean;
  requestedSessionFile?: string;
  registration?: BridgeRegistration;
  socket?: net.Socket;
  connecting: boolean;
  authenticated: boolean;
  status: BridgeConnectionStatus;
  state?: BridgeSessionState;
  snapshotEntries: unknown[];
  hasSnapshot: boolean;
  visibleMessages: SessionMessage[];
  optimisticUserMessages: OptimisticUserMessage[];
  pendingAssistant?: SessionMessage;
  thinkingCounts: Record<string, number>;
  userInputWaits: Map<string, BridgeUserInputWait>;
  sessionCost?: number;
  lastSequence: number;
  pendingCommands: Map<string, PendingCommand>;
  startupTimer?: NodeJS.Timeout;
}

export interface PiTerminalSessionView {
  bridgeId: string;
  status: BridgeConnectionStatus;
  statusMessage?: string;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messages: SessionMessage[];
  contextUsage?: ContextUsage;
  terminalExited: boolean;
  waitingForUser: boolean;
  waitingForUserMessage?: string;
  playCompletionSound?: boolean;
  actionError?: string;
}

export interface SendTerminalSessionResult {
  bridgeId: string;
  sessionFilePath?: string;
}

export class PiTerminalSessions implements vscode.Disposable {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly emitter = new vscode.EventEmitter<PiTerminalSessionView>();
  private readonly registrationDirectory: string;
  private readonly globalBridgeRoot: string;
  private registrationWatcher?: fs.FSWatcher;
  private scanTimer?: NodeJS.Timeout;
  private disposed = false;

  readonly onDidChangeSession = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const workspaceKey = crypto
      .createHash("sha256")
      .update(
        `${vscode.env.sessionId}:${context.storageUri?.fsPath || getWorkspaceCwd() || "empty-window"}`,
      )
      .digest("hex")
      .slice(0, 20);
    this.globalBridgeRoot = path.join(
      context.globalStorageUri.fsPath,
      "bridges",
    );
    this.registrationDirectory = path.join(this.globalBridgeRoot, workspaceKey);
    fs.mkdirSync(this.registrationDirectory, { recursive: true, mode: 0o700 });
    this.startRegistrationDiscovery();
    context.subscriptions.push(
      this,
      vscode.window.onDidCloseTerminal((terminal) =>
        this.handleTerminalClosed(terminal),
      ),
    );
  }

  async sendSessionMessage(
    filePath: string,
    text: string,
    providerCliArgs = "",
    clientMessageId: string = crypto.randomUUID(),
  ): Promise<SendTerminalSessionResult> {
    if (!text) throw new Error("Message text cannot be empty.");
    if (filePath && !isSessionFile(filePath))
      throw new Error("Invalid Pi session file.");

    const resolvedFilePath = filePath ? path.resolve(filePath) : undefined;
    const existing = resolvedFilePath
      ? this.findBySessionFile(resolvedFilePath)
      : undefined;
    if (existing) {
      if (existing.status === "connected") {
        const outbound = this.appendOptimisticUserMessage(
          existing,
          text,
          clientMessageId,
        );
        this.emit(existing);
        try {
          await this.sendCommand(existing, "send_user_message", {
            clientMessageId,
            text,
            delivery: "followUp",
          });
          if (outbound.deliveryState === "pending") {
            outbound.deliveryState = "accepted";
            this.setVisibleDeliveryState(existing, clientMessageId, "accepted");
          }
        } catch (error) {
          if (existing.optimisticUserMessages.includes(outbound)) {
            outbound.deliveryState = "failed";
            this.setVisibleDeliveryState(existing, clientMessageId, "failed");
            this.emit(existing);
          }
          throw error;
        }
        return {
          bridgeId: existing.bridgeId,
          sessionFilePath: existing.state?.sessionFile,
        };
      }
      if (
        !existing.terminalExited &&
        isProcessAlive(existing.registration?.pid)
      ) {
        throw new Error(
          "The Pi terminal is still running, but its qcode bridge is unavailable. Use the terminal or wait for reconnection.",
        );
      }
    }
    if (resolvedFilePath) {
      const foreignOwner = this.findForeignLiveOwner(resolvedFilePath);
      if (foreignOwner) {
        throw new Error(
          "This session is already owned by a live qcode Pi terminal in another VS Code window. Use that terminal/window instead.",
        );
      }
    }

    const cwd = getWorkspaceCwd();
    if (!cwd)
      throw new Error("Unable to start session: no workspace folder is open.");
    const bridgeId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    const registrationPath = path.join(
      this.registrationDirectory,
      `${bridgeId}.json`,
    );
    const providerArgs = splitCliArgs(providerCliArgs);
    const env: Record<string, string | null> = {
      QCODE_BRIDGE_ID: bridgeId,
      QCODE_BRIDGE_TOKEN: token,
      QCODE_BRIDGE_REGISTRATION: registrationPath,
      QCODE_INITIAL_CLIENT_MESSAGE_ID: clientMessageId,
    };
    if (usesOpenAiCodexModelProvider(providerArgs))
      env.PI_CACHE_RETENTION = "long";

    const terminalShell = resolveTerminalShell(vscode.env.shell);
    const terminal = vscode.window.createTerminal({
      name: `Pi qcode ${bridgeId.slice(0, 8)}`,
      cwd,
      env,
      ...(terminalShell.shellPath ? { shellPath: terminalShell.shellPath } : {}),
    });
    const initialMessages = resolvedFilePath
      ? readSessionDetail(resolvedFilePath).messages.map((message) => ({
          ...message,
          counts: message.counts ? { ...message.counts } : undefined,
          activatedSkills: message.activatedSkills
            ? [...message.activatedSkills]
            : undefined,
        }))
      : [];
    removeThinking(initialMessages);
    const session: ManagedSession = {
      bridgeId,
      token,
      registrationPath,
      terminal,
      terminalExited: false,
      requestedSessionFile: resolvedFilePath,
      connecting: false,
      authenticated: false,
      status: "connecting",
      snapshotEntries: [],
      hasSnapshot: false,
      visibleMessages: initialMessages,
      optimisticUserMessages: [],
      thinkingCounts: {},
      userInputWaits: new Map(),
      sessionCost: undefined,
      lastSequence: 0,
      pendingCommands: new Map(),
    };
    const terminalPrompt = normalizeMessageArgument(text);
    this.appendOptimisticUserMessage(session, terminalPrompt, clientMessageId);
    this.sessions.set(bridgeId, session);
    session.startupTimer = setTimeout(() => {
      session.startupTimer = undefined;
      if (session.registration || session.terminalExited || this.disposed)
        return;
      session.status = "bridge_unavailable";
      this.emit(
        session,
        "Pi bridge did not register.",
        false,
        "The qcode bridge did not start. Please inspect the Pi terminal for errors.",
      );
    }, BRIDGE_STARTUP_TIMEOUT_MS);
    this.emit(session, "Waiting for Pi bridge…");

    const bridgePath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "pi-extensions",
      "qcode-bridge.ts",
    ).fsPath;
    const args = ["-e", bridgePath];
    if (resolvedFilePath) args.push("--session", resolvedFilePath);
    else args.push(...providerArgs);
    args.push(terminalPrompt);
    terminal.sendText(buildTerminalCommand("pi", args, terminalShell.kind), true);
    void this.scanRegistrations();
    return { bridgeId, sessionFilePath: resolvedFilePath };
  }

  getSessionByFile(filePath: string): PiTerminalSessionView | undefined {
    const session = this.findBySessionFile(path.resolve(filePath));
    return session ? this.toView(session) : undefined;
  }

  getSession(bridgeId: string): PiTerminalSessionView | undefined {
    const session = this.sessions.get(bridgeId);
    return session ? this.toView(session) : undefined;
  }

  async requestSnapshot(bridgeId: string): Promise<void> {
    const session = this.sessions.get(bridgeId);
    if (!session || session.status !== "connected") return;
    await this.sendCommand(session, "request_snapshot", {});
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registrationWatcher?.close();
    if (this.scanTimer) clearInterval(this.scanTimer);
    for (const session of this.sessions.values()) {
      if (session.startupTimer) clearTimeout(session.startupTimer);
      this.disconnect(session, false);
    }
    this.emitter.dispose();
  }

  private startRegistrationDiscovery(): void {
    try {
      this.registrationWatcher = fs.watch(
        this.registrationDirectory,
        { persistent: false },
        () => {
          void this.scanRegistrations();
        },
      );
    } catch {
      /* periodic scan remains available */
    }
    this.scanTimer = setInterval(
      () => void this.scanRegistrations(),
      REGISTRATION_SCAN_INTERVAL_MS,
    );
    void this.scanRegistrations();
  }

  private async scanRegistrations(): Promise<void> {
    if (this.disposed) return;
    let names: string[];
    try {
      names = await fs.promises.readdir(this.registrationDirectory);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const filePath = path.join(this.registrationDirectory, name);
          let registration: BridgeRegistration | undefined;
          try {
            registration = readBridgeRegistration(
              JSON.parse(await fs.promises.readFile(filePath, "utf8")),
            );
          } catch {
            return;
          }
          if (!registration) return;
          if (!isProcessAlive(registration.pid)) {
            await fs.promises.rm(filePath, { force: true }).catch(() => {});
            const stale = this.sessions.get(registration.bridgeId);
            if (stale && !stale.terminalExited) {
              stale.terminalExited = true;
              stale.status = "terminal_exited";
              this.emit(stale, "Pi process exited.");
            }
            return;
          }
          let session = this.sessions.get(registration.bridgeId);
          if (!session) {
            session = {
              bridgeId: registration.bridgeId,
              token: registration.token,
              registrationPath: filePath,
              terminalExited: false,
              requestedSessionFile: registration.sessionFile
                ? path.resolve(registration.sessionFile)
                : undefined,
              registration,
              connecting: false,
              authenticated: false,
              status:
                registration.protocolVersion === PI_BRIDGE_PROTOCOL_VERSION
                  ? "reconnecting"
                  : "bridge_incompatible",
              snapshotEntries: [],
              hasSnapshot: false,
              visibleMessages: [],
              optimisticUserMessages: [],
              thinkingCounts: {},
              userInputWaits: new Map(),
              sessionCost: undefined,
              lastSequence: 0,
              pendingCommands: new Map(),
            };
            this.sessions.set(session.bridgeId, session);
          } else if (session.token !== registration.token) {
            // A registration with our bridge ID but a different secret cannot take over this session.
            return;
          }
          if (registration.protocolVersion !== PI_BRIDGE_PROTOCOL_VERSION) {
            session.status = "bridge_incompatible";
            this.emit(
              session,
              "Bridge protocol is incompatible. Update Pi and pi-qcode.",
              false,
              "The Pi bridge protocol is incompatible. Update Pi and pi-qcode.",
            );
            return;
          }
          if (session.startupTimer) {
            clearTimeout(session.startupTimer);
            session.startupTimer = undefined;
          }
          const instanceChanged =
            session.registration?.instanceId !== registration.instanceId;
          const endpointChanged =
            session.registration?.port !== registration.port;
          if (instanceChanged) session.lastSequence = 0;
          session.registration = registration;
          if (registration.sessionFile)
            session.requestedSessionFile = path.resolve(
              registration.sessionFile,
            );
          if ((instanceChanged || endpointChanged) && session.socket)
            this.disconnect(session, true);
          if (!session.socket && !session.connecting) this.connect(session);
        }),
    );
  }

  private connect(session: ManagedSession): void {
    const registration = session.registration;
    if (!registration || this.disposed) return;
    session.connecting = true;
    session.authenticated = false;
    session.status =
      session.status === "connecting" ? "connecting" : "reconnecting";
    this.emit(
      session,
      session.status === "connecting"
        ? "Connecting to Pi…"
        : "Reconnecting to Pi…",
    );
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: registration.port,
    });
    const decoder = new JsonLineDecoder();
    session.socket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(COMMAND_TIMEOUT_MS);
    socket.on("connect", () => {
      socket.setTimeout(0);
      session.connecting = false;
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        session.pendingCommands.delete(requestId);
        socket.destroy();
      }, COMMAND_TIMEOUT_MS);
      session.pendingCommands.set(requestId, {
        timer,
        resolve: () => {
          session.authenticated = true;
        },
        reject: () => socket.destroy(),
      });
      socket.write(
        encodeBridgeRecord({
          protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
          type: "authenticate",
          requestId,
          token: session.token,
        }),
      );
    });
    socket.on("data", (chunk) => {
      if (session.socket !== socket) return;
      for (const result of decoder.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      )) {
        if (result.kind === "error") {
          if (result.code === "record_too_large") socket.destroy();
          continue;
        }
        const validation = validateBridgeMessage(result.value);
        if (!validation.ok) {
          if (validation.code === "incompatible_protocol") {
            session.status = "bridge_incompatible";
            this.emit(session, validation.message, false, validation.message);
            socket.destroy();
          }
          continue;
        }
        if (validation.message.bridgeId !== session.bridgeId) {
          socket.destroy();
          continue;
        }
        this.handleBridgeMessage(session, validation.message);
      }
    });
    socket.on("close", () => {
      decoder.end();
      if (session.socket !== socket) return;
      session.socket = undefined;
      session.connecting = false;
      session.authenticated = false;
      this.rejectPending(session, new Error("Pi bridge disconnected."));
      if (
        !this.disposed &&
        !session.terminalExited &&
        session.status !== "bridge_incompatible"
      ) {
        if (session.status !== "bridge_unavailable")
          session.status = "reconnecting";
        this.emit(
          session,
          session.status === "bridge_unavailable"
            ? "Bridge unavailable. The Pi terminal remains usable."
            : "Pi terminal is usable; reconnecting qcode bridge…",
        );
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (session.socket !== socket) return;
      session.connecting = false;
      if (error.code === "ECONNREFUSED" && session.registration) {
        void removeRegistrationIfOwned(
          session.registrationPath,
          session.registration,
        );
      }
      if (!session.terminalExited) {
        session.status = "bridge_unavailable";
        this.emit(
          session,
          "Bridge unavailable. The Pi terminal remains usable.",
        );
      }
    });
  }

  private handleBridgeMessage(
    session: ManagedSession,
    message: BridgeToQcodeMessage,
  ): void {
    if (message.sequence <= session.lastSequence) return;
    session.lastSequence = message.sequence;
    if (message.type === "command_ack") {
      this.handleAcknowledgement(session, message);
      return;
    }
    if (message.type === "hello") {
      this.applyHello(session, message);
      return;
    }
    if (message.type === "session_state") {
      session.state = message.state;
      this.emit(session);
      return;
    }
    if (message.type === "session_snapshot") {
      this.applySnapshot(session, message);
      this.emit(session);
      return;
    }
    if (message.type === "user_input") {
      this.applyUserInput(session, message);
      if (session.hasSnapshot) this.emit(session);
      return;
    }
    if (
      message.type === "user_input_wait_start" ||
      message.type === "user_input_wait_end"
    ) {
      this.applyUserInputWait(session, message);
      this.emit(session);
      return;
    }
    if (message.type === "agent_start") {
      removeThinking(session.visibleMessages);
      session.thinkingCounts = {};
      upsertThinking(session);
      this.emit(session);
      return;
    }
    if (message.type === "message_start" || message.type === "message_end") {
      this.applyMessageEvent(session, message);
      this.emit(session);
      return;
    }
    if (
      message.type === "tool_execution_start" ||
      message.type === "tool_execution_end"
    ) {
      this.applyToolEvent(session, message);
      this.emit(session);
      return;
    }
    if (message.type === "agent_settled") {
      session.userInputWaits.clear();
      finalizeAssistant(session);
      this.emit(session, undefined, true);
      return;
    }
    if (message.type === "session_compact") {
      void this.requestSnapshot(session.bridgeId);
      return;
    }
    if (message.type === "session_shutdown") {
      session.userInputWaits.clear();
      session.status = "reconnecting";
      this.emit(
        session,
        `Pi session is ${message.reason || "reloading"}; reconnecting…`,
      );
      return;
    }
    if (message.type === "bridge_error") {
      if (
        message.code === "incompatible_pi" ||
        message.code === "incompatible_protocol"
      ) {
        session.status = "bridge_incompatible";
      }
      this.emit(
        session,
        message.message,
        false,
        session.status === "bridge_incompatible" ? message.message : undefined,
      );
    }
  }

  private applyHello(session: ManagedSession, hello: BridgeHelloEvent): void {
    if (
      session.registration &&
      hello.instanceId !== session.registration.instanceId
    )
      return;
    session.authenticated = true;
    session.status = "connected";
    session.terminalExited = false;
    session.userInputWaits = new Map(
      (hello.userInputWaits || []).map((wait) => [wait.waitId, wait]),
    );
    session.state = {
      sessionId: hello.sessionId,
      sessionFile: hello.sessionFile,
      sessionName: hello.sessionName,
      leafId: hello.leafId,
      idle: hello.idle,
      model: hello.model,
      thinkingLevel: hello.thinkingLevel,
      contextUsage: hello.contextUsage,
    };
    if (hello.sessionFile)
      session.requestedSessionFile = path.resolve(hello.sessionFile);
    // The snapshot follows hello on the same socket. Emitting here could briefly
    // replace a persisted or optimistic baseline with an empty reconnect state.
  }

  private applySnapshot(
    session: ManagedSession,
    snapshot: BridgeSessionSnapshotEvent,
  ): void {
    session.snapshotEntries = snapshot.entries;
    session.hasSnapshot = true;
    const presentation = buildBridgePresentation(
      snapshot.entries,
      session.state?.idle ?? true,
    );
    session.visibleMessages = presentation.messages;
    session.pendingAssistant = presentation.pendingAssistant;
    session.thinkingCounts = presentation.thinkingCounts;
    session.sessionCost = presentation.sessionCost;

    // A new Pi process can publish a snapshot before qcode observes message_start.
    // Reconcile prompts already present in that snapshot, and overlay only prompts
    // that are still absent so resumed sessions do not render them twice.
    const unresolvedMessages: OptimisticUserMessage[] = [];
    for (const optimisticMessage of session.optimisticUserMessages) {
      const authoritativeText =
        optimisticMessage.authoritativeText || optimisticMessage.text;
      const occurrenceCount = countMatchingUserMessages(
        session.visibleMessages,
        authoritativeText,
      );
      // The snapshot is authoritative. A new matching occurrence proves the
      // optimistic prompt was persisted even if its raw input event was missed.
      if (occurrenceCount > optimisticMessage.baselineOccurrenceCount) continue;
      removeThinking(session.visibleMessages);
      session.visibleMessages.push({
        role: "user",
        kind: "message",
        text: authoritativeText,
        clientMessageId: optimisticMessage.clientMessageId,
        deliveryState: optimisticMessage.deliveryState,
      });
      unresolvedMessages.push(optimisticMessage);
    }
    session.optimisticUserMessages = unresolvedMessages;
  }

  private applyUserInput(
    session: ManagedSession,
    event: BridgeUserInputEvent,
  ): void {
    if (event.clientMessageId) {
      const optimistic = session.optimisticUserMessages.find(
        (item) => item.clientMessageId === event.clientMessageId,
      );
      if (optimistic) {
        optimistic.deliveryState = "correlated";
        optimistic.authoritativeText = event.text;
        const visibleIndex = session.visibleMessages.findIndex(
          (message) => message.clientMessageId === event.clientMessageId,
        );
        const authoritativeCount = session.visibleMessages.reduce(
          (count, message, index) =>
            count +
            (index !== visibleIndex &&
            message.role === "user" &&
            userMessageTextsMatch(message.text, event.text)
              ? 1
              : 0),
          0,
        );
        if (authoritativeCount > optimistic.baselineOccurrenceCount) {
          if (visibleIndex !== -1)
            session.visibleMessages.splice(visibleIndex, 1);
          session.optimisticUserMessages =
            session.optimisticUserMessages.filter(
              (item) => item !== optimistic,
            );
          return;
        }
        const visible =
          visibleIndex === -1
            ? undefined
            : session.visibleMessages[visibleIndex];
        if (visible) {
          visible.text = normalizeUserMessageText(event.text);
          visible.deliveryState = "correlated";
        }
        return;
      }
    }

    removeThinking(session.visibleMessages);
    const text = normalizeUserMessageText(event.text);
    const previous = session.visibleMessages.at(-1);
    if (!(previous?.role === "user" && userMessageTextsMatch(previous.text, text))) {
      session.visibleMessages.push({ role: "user", kind: "message", text });
    }
  }

  private applyMessageEvent(
    session: ManagedSession,
    event: BridgeMessageEvent,
  ): void {
    const message = readRecord(event.message);
    const role = typeof message?.role === "string" ? message.role : "";
    if (role === "user" && event.type === "message_start") {
      const text = readMessageText(message);
      if (!text) return;
      const skillName = readActivatedSkillName(text);
      const optimisticIndex = session.optimisticUserMessages.findIndex(
        (message) =>
          userMessageTextsMatch(message.authoritativeText || message.text, text),
      );
      if (optimisticIndex !== -1)
        session.optimisticUserMessages.splice(optimisticIndex, 1);
      removeThinking(session.visibleMessages);
      const previous = session.visibleMessages.at(-1);
      if (!(previous?.role === "user" && userMessageTextsMatch(previous.text, text))) {
        session.visibleMessages.push({
          role: "user",
          kind: "message",
          text,
          ...(skillName ? { activatedSkills: [skillName] } : {}),
        });
      } else if (previous && skillName) {
        previous.text = normalizeUserMessageText(previous.text);
        previous.activatedSkills = [skillName];
      }
      session.pendingAssistant = undefined;
      session.thinkingCounts = skillName ? { [`/skill:${skillName}`]: 1 } : {};
      upsertThinking(session);
      return;
    }
    if (role === "assistant" && event.type === "message_end") {
      const assistant = readAssistantMessage(message);
      if (assistant) session.pendingAssistant = assistant;
    }
  }

  private applyToolEvent(
    session: ManagedSession,
    event: BridgeToolEvent,
  ): void {
    if (event.type !== "tool_execution_start") return;
    const toolName = event.toolName || "tool";
    const thinkingKey = getToolThinkingKey(toolName, undefined, event.skillName);
    session.thinkingCounts[thinkingKey] = thinkingKey.startsWith("/skill:")
      ? 1
      : (session.thinkingCounts[thinkingKey] || 0) + 1;
    upsertThinking(session);
  }

  private applyUserInputWait(
    session: ManagedSession,
    event: BridgeUserInputWaitEvent,
  ): void {
    if (event.type === "user_input_wait_start") {
      session.userInputWaits.set(event.waitId, {
        waitId: event.waitId,
        ...(event.message ? { message: event.message } : {}),
      });
    } else {
      session.userInputWaits.delete(event.waitId);
    }
  }

  private setVisibleDeliveryState(
    session: ManagedSession,
    clientMessageId: string,
    deliveryState: SessionMessage["deliveryState"],
  ): void {
    const visible = session.visibleMessages.find(
      (message) => message.clientMessageId === clientMessageId,
    );
    if (visible) visible.deliveryState = deliveryState;
  }

  private appendOptimisticUserMessage(
    session: ManagedSession,
    text: string,
    clientMessageId: string,
  ): OptimisticUserMessage {
    const existing = session.optimisticUserMessages.find(
      (message) => message.clientMessageId === clientMessageId,
    );
    if (existing) {
      existing.deliveryState = "pending";
      this.setVisibleDeliveryState(session, clientMessageId, "pending");
      return existing;
    }

    removeThinking(session.visibleMessages);
    const outbound: OptimisticUserMessage = {
      clientMessageId,
      text,
      baselineOccurrenceCount: countMatchingUserMessages(session.visibleMessages, text),
      preSendLeafId: session.state?.leafId,
      preSendSequence: session.lastSequence,
      deliveryState: "pending",
    };
    session.optimisticUserMessages.push(outbound);
    session.visibleMessages.push({
      role: "user",
      kind: "message",
      text: normalizeUserMessageText(text),
      clientMessageId,
      deliveryState: "pending",
    });
    return outbound;
  }

  private handleAcknowledgement(
    session: ManagedSession,
    ack: BridgeCommandAck,
  ): void {
    const pending = session.pendingCommands.get(ack.requestId);
    if (!pending) return;
    session.pendingCommands.delete(ack.requestId);
    clearTimeout(pending.timer);
    if (ack.ok) pending.resolve();
    else
      pending.reject(
        new Error(ack.error?.message || "Pi bridge command failed."),
      );
  }

  private sendCommand(
    session: ManagedSession,
    type: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const socket = session.socket;
    if (!socket || socket.destroyed || !session.authenticated) {
      return Promise.reject(
        new Error("Pi bridge is not connected. The terminal remains usable."),
      );
    }
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pendingCommands.delete(requestId);
        reject(new Error(`Pi bridge command timed out: ${type}`));
      }, COMMAND_TIMEOUT_MS);
      session.pendingCommands.set(requestId, { resolve, reject, timer });
      socket.write(
        encodeBridgeRecord({
          protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
          type,
          requestId,
          ...fields,
        }),
        (error) => {
          if (!error) return;
          const pending = session.pendingCommands.get(requestId);
          if (!pending) return;
          session.pendingCommands.delete(requestId);
          clearTimeout(pending.timer);
          reject(error);
        },
      );
    });
  }

  private findForeignLiveOwner(
    filePath: string,
  ): BridgeRegistration | undefined {
    let directories: fs.Dirent[];
    try {
      directories = fs.readdirSync(this.globalBridgeRoot, {
        withFileTypes: true,
      });
    } catch {
      return undefined;
    }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const directoryPath = path.join(this.globalBridgeRoot, directory.name);
      if (
        path.resolve(directoryPath) === path.resolve(this.registrationDirectory)
      )
        continue;
      let names: string[];
      try {
        names = fs.readdirSync(directoryPath);
      } catch {
        continue;
      }
      for (const name of names.filter((entry) => entry.endsWith(".json"))) {
        const registrationPath = path.join(directoryPath, name);
        try {
          const registration = readBridgeRegistration(
            JSON.parse(fs.readFileSync(registrationPath, "utf8")),
          );
          if (!registration) continue;
          if (!isProcessAlive(registration.pid)) {
            fs.rmSync(registrationPath, { force: true });
            continue;
          }
          if (
            registration.sessionFile &&
            path.resolve(registration.sessionFile) === filePath
          )
            return registration;
        } catch {
          /* registration may be atomically replaced */
        }
      }
    }
    return undefined;
  }

  private findBySessionFile(filePath: string): ManagedSession | undefined {
    const resolved = path.resolve(filePath);
    return [...this.sessions.values()].find((session) => {
      const candidate =
        session.state?.sessionFile ||
        session.registration?.sessionFile ||
        session.requestedSessionFile;
      return candidate ? path.resolve(candidate) === resolved : false;
    });
  }

  private handleTerminalClosed(terminal: vscode.Terminal): void {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.terminal === terminal,
    );
    if (!session) return;
    session.terminalExited = true;
    session.status = "terminal_exited";
    session.userInputWaits.clear();
    if (session.startupTimer) {
      clearTimeout(session.startupTimer);
      session.startupTimer = undefined;
    }
    this.disconnect(session, false);
    this.emit(session, "Pi terminal exited.");
  }

  private disconnect(session: ManagedSession, reconnecting: boolean): void {
    const socket = session.socket;
    session.socket = undefined;
    session.connecting = false;
    session.authenticated = false;
    if (socket) socket.destroy();
    this.rejectPending(session, new Error("Pi bridge disconnected."));
    if (reconnecting && !session.terminalExited)
      session.status = "reconnecting";
  }

  private rejectPending(session: ManagedSession, error: Error): void {
    for (const pending of session.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pendingCommands.clear();
  }

  private emit(
    session: ManagedSession,
    statusMessage?: string,
    playCompletionSound = false,
    actionError?: string,
  ): void {
    this.emitter.fire({
      ...this.toView(session),
      statusMessage,
      playCompletionSound,
      actionError,
    });
  }

  private toView(session: ManagedSession): PiTerminalSessionView {
    const usage = session.state?.contextUsage;
    const modelWindow = session.state?.model?.contextWindow;
    return {
      bridgeId: session.bridgeId,
      status: session.status,
      sessionFile:
        session.state?.sessionFile ||
        session.registration?.sessionFile ||
        session.requestedSessionFile,
      sessionId: session.state?.sessionId || session.registration?.sessionId,
      sessionName:
        session.state?.sessionName || session.registration?.sessionName,
      messages: session.visibleMessages.map((message) => ({
        ...message,
        counts: message.counts ? { ...message.counts } : undefined,
        activatedSkills: message.activatedSkills
          ? [...message.activatedSkills]
          : undefined,
      })),
      contextUsage:
        usage ||
        session.state?.model ||
        session.state?.thinkingLevel ||
        session.sessionCost !== undefined
          ? {
              usedTokens: usage?.tokens,
              contextWindow: usage?.contextWindow || modelWindow,
              percent: usage?.percent,
              modelId: session.state?.model?.id,
              provider: session.state?.model?.provider,
              thinkingLevel: session.state?.thinkingLevel,
              // An attached bridge is authoritative: an omitted bridge cost means
              // the total is unknown, not that a truncated snapshot total is safe.
              sessionCost: usage ? usage.sessionCost : session.sessionCost,
            }
          : undefined,
      terminalExited: session.terminalExited,
      waitingForUser: session.userInputWaits.size > 0,
      waitingForUserMessage: [...session.userInputWaits.values()]
        .map((wait) => wait.message)
        .find((message): message is string => Boolean(message)),
    };
  }
}

function buildBridgePresentation(
  entries: unknown[],
  idle: boolean,
): {
  messages: SessionMessage[];
  pendingAssistant?: SessionMessage;
  thinkingCounts: Record<string, number>;
  sessionCost?: number;
} {
  const content = entries
    .map((entry) => {
      try {
        return JSON.stringify(entry);
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n");
  const messages: SessionMessage[] = readSessionMessagesFromContent(
    content,
  ).messages.map((message) => ({
    ...message,
    counts: message.counts ? { ...message.counts } : undefined,
    activatedSkills: message.activatedSkills
      ? [...message.activatedSkills]
      : undefined,
  }));
  const thinkingMessage =
    messages.at(-1)?.kind === "thinking" ? messages.pop() : undefined;
  const thinkingCounts = { ...(thinkingMessage?.counts || {}) };
  let pendingAssistant: SessionMessage | undefined;
  let sessionCost = 0;
  let sessionCostKnown = true;
  let lastRunStartIndex = -1;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = readRecord(entries[index]);
    if (entry?.type === "custom" && entry.customType === "pi-lifecycle") {
      const data = readRecord(entry.data);
      if (data?.event === "agent_start") lastRunStartIndex = index;
      if (data?.event === "agent_end" || data?.event === "session_shutdown") {
        lastRunStartIndex = -1;
      }
    }
    if (entry?.type !== "message") continue;
    const message = readRecord(entry.message);
    if (message?.role !== "assistant") continue;
    const usage = readRecord(message.usage);
    const rawCost = readRecord(usage?.cost)?.total;
    const cost = typeof rawCost === "number" && Number.isFinite(rawCost)
      ? rawCost
      : undefined;
    if (cost === undefined || cost < 0) sessionCostKnown = false;
    else sessionCost += cost;
    if (!idle && index > lastRunStartIndex && lastRunStartIndex !== -1) {
      const assistant = readAssistantMessage(message);
      if (assistant) pendingAssistant = assistant;
    }
  }
  if (!idle) {
    const thinking = createThinkingMessage(thinkingCounts);
    if (thinking?.text) messages.push(thinking);
  }
  return {
    messages,
    pendingAssistant,
    thinkingCounts,
    sessionCost: sessionCostKnown ? sessionCost : undefined,
  };
}

function readAssistantMessage(
  message: Record<string, unknown> | undefined,
): SessionMessage | undefined {
  if (!message) return undefined;
  const stopReason =
    typeof message.stopReason === "string" ? message.stopReason : "";
  const error =
    (stopReason === "error" || stopReason === "aborted") &&
    typeof message.errorMessage === "string"
      ? message.errorMessage.trim()
      : "";
  const text = error || readMessageText(message);
  if (!text) return undefined;
  const timestamp = readBridgeMessageTimestamp(message.timestamp);
  return {
    role: "assistant",
    kind: "message",
    text,
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}

function readBridgeMessageTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readMessageText(message: Record<string, unknown> | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string")
    return collapseSkillContent(message.content);
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> =>
      Boolean(item?.type === "text" && typeof item.text === "string"),
    )
    .map((item) => collapseSkillContent(String(item.text)))
    .join("\n");
}

function finalizeAssistant(session: ManagedSession): void {
  removeThinking(session.visibleMessages);
  if (session.pendingAssistant)
    session.visibleMessages.push(session.pendingAssistant);
  session.pendingAssistant = undefined;
  session.thinkingCounts = {};
}

function upsertThinking(session: ManagedSession): void {
  removeThinking(session.visibleMessages);
  const thinking = createThinkingMessage(session.thinkingCounts);
  if (thinking) session.visibleMessages.push(thinking);
}

function removeThinking(messages: SessionMessage[]): void {
  if (messages.at(-1)?.kind === "thinking") messages.pop();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeMessageArgument(message: string): string {
  return message.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getWorkspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function removeRegistrationIfOwned(
  filePath: string,
  expected: BridgeRegistration,
): Promise<void> {
  try {
    const current = readBridgeRegistration(
      JSON.parse(await fs.promises.readFile(filePath, "utf8")),
    );
    if (
      current?.bridgeId === expected.bridgeId &&
      current.instanceId === expected.instanceId &&
      current.pid === expected.pid
    ) {
      await fs.promises.rm(filePath, { force: true });
    }
  } catch {
    /* registration was already replaced/removed */
  }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM",
    );
  }
}
