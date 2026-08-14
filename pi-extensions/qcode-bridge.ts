import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PROTOCOL_VERSION = 1;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 192 * 1024;
const MAX_SNAPSHOT_ENTRIES = 2000;
const MAX_TEXT_BYTES = MAX_MESSAGE_BYTES;
const ENV_BRIDGE_ID = "QCODE_BRIDGE_ID";
const ENV_TOKEN = "QCODE_BRIDGE_TOKEN";
const ENV_REGISTRATION = "QCODE_BRIDGE_REGISTRATION";
const ENV_INITIAL_CLIENT_MESSAGE_ID = "QCODE_INITIAL_CLIENT_MESSAGE_ID";
const IDEMPOTENCY_CACHE_SIZE = 256;

type JsonRecord = Record<string, unknown>;
type Client = {
  socket: net.Socket;
  authenticated: boolean;
  decoder: LineDecoder;
};
type AckOutcome = { ok: boolean; code?: string; message?: string };
type CorrelatedInput = { clientMessageId: string; text: string };
type ProcessBridgeState = {
  consumedInitialBridgeIds: Set<string>;
  acceptedClientMessageIds: Map<string, true>;
  requestOutcomes: Map<string, AckOutcome>;
};

const processStateKey = Symbol.for("pi-qcode.bridge.process-state.v1");
const processGlobal = globalThis as unknown as Record<
  symbol,
  ProcessBridgeState | undefined
>;
const processState = (processGlobal[processStateKey] ??= {
  consumedInitialBridgeIds: new Set(),
  acceptedClientMessageIds: new Map(),
  requestOutcomes: new Map(),
});

class LineDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private text = "";
  private bytes = 0;
  private oversized = false;

  push(
    chunk: Buffer,
    onRecord: (value: unknown) => void,
    onError: (code: string, message: string) => void,
  ): void {
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      this.append(chunk.subarray(start, index));
      if (this.oversized || this.bytes > MAX_RECORD_BYTES) {
        onError(
          "record_too_large",
          `Bridge command exceeds ${MAX_RECORD_BYTES} bytes.`,
        );
      } else {
        let line = this.text;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line) {
          try {
            onRecord(JSON.parse(line));
          } catch {
            onError("malformed_json", "Bridge command is malformed JSON.");
          }
        }
      }
      this.reset();
      start = index + 1;
    }
    this.append(chunk.subarray(start));
    if (this.bytes > MAX_RECORD_BYTES) {
      this.oversized = true;
      this.text = "";
    }
  }

  private append(chunk: Buffer): void {
    this.bytes += chunk.length;
    if (!this.oversized) this.text += this.decoder.write(chunk);
  }

  private reset(): void {
    this.decoder.end();
    this.text = "";
    this.bytes = 0;
    this.oversized = false;
  }
}

export default function qcodeBridge(pi: ExtensionAPI): void {
  const bridgeId = process.env[ENV_BRIDGE_ID];
  const token = process.env[ENV_TOKEN];
  const registrationPath = process.env[ENV_REGISTRATION];
  const initialClientMessageId = process.env[ENV_INITIAL_CLIENT_MESSAGE_ID];
  if (!bridgeId || !token || !registrationPath) return;

  const instanceId = crypto.randomUUID();
  let server: net.Server | undefined;
  let currentContext: ExtensionContext | undefined;
  let activeClient: Client | undefined;
  const clients = new Set<Client>();
  let stopped = false;
  let compatibilityError: string | undefined;
  let sequence = 0;
  let initialInputEligible = false;
  let currentRunId: string | undefined;
  let currentRunStartedAt: number | undefined;
  let trackedSessionCost: number | undefined;
  let registrationWrites: Promise<void> = Promise.resolve();
  const correlatedInputs: CorrelatedInput[] = [];
  const activeUserInputWaits = new Map<string, { waitId: string; message?: string }>();
  const pendingUserInputEvents: Array<{
    text: string;
    source: string;
    clientMessageId?: string;
  }> = [];

  const base = (type: string): JsonRecord => ({
    protocolVersion: PROTOCOL_VERSION,
    type,
    bridgeId,
    sequence: ++sequence,
  });
  const write = (client: Client, record: JsonRecord): void => {
    if (client.socket.destroyed) return;
    let json: string;
    try {
      json = JSON.stringify(record);
    } catch {
      return;
    }
    if (Buffer.byteLength(json, "utf8") > MAX_RECORD_BYTES) {
      json = JSON.stringify({
        ...base("bridge_error"),
        code: "record_too_large",
        message: "A bridge event was too large and was not sent.",
      });
    }
    client.socket.write(`${json}\n`);
  };
  const publish = (record: JsonRecord): void => {
    if (activeClient?.authenticated) write(activeClient, record);
  };
  const ack = (
    client: Client,
    requestId: string,
    ok: boolean,
    code?: string,
    message?: string,
  ): void => {
    write(client, {
      ...base("command_ack"),
      requestId,
      ok,
      ...(!ok
        ? {
            error: {
              code: code || "command_failed",
              message: message || "Bridge command failed.",
            },
          }
        : {}),
    });
  };
  const rememberRequestOutcome = (
    requestId: string,
    outcome: AckOutcome,
  ): void => {
    rememberBounded(
      processState.requestOutcomes,
      `${bridgeId}:${requestId}`,
      outcome,
    );
  };
  const ackAndRemember = (
    client: Client,
    requestId: string,
    outcome: AckOutcome,
  ): void => {
    rememberRequestOutcome(requestId, outcome);
    ack(client, requestId, outcome.ok, outcome.code, outcome.message);
  };
  const appendLifecycle = (
    event: "session_start" | "agent_start" | "agent_end" | "session_shutdown",
    state: "idle" | "busy",
    extra: JsonRecord = {},
  ): void => {
    try {
      pi.appendEntry("pi-lifecycle", {
        extension: "pi-lifecycle",
        version: 1,
        event,
        state,
        timestamp: Date.now(),
        pid: process.pid,
        ...extra,
      });
    } catch {
      // Persistence failure must never interfere with the interactive Pi process.
    }
  };

  const contextUsage = (ctx: ExtensionContext): JsonRecord | undefined => {
    try {
      const usage = ctx.getContextUsage?.();
      if (!usage && trackedSessionCost === undefined) return undefined;
      const value = usage as unknown as JsonRecord | undefined;
      return {
        tokens: finiteNumber(value?.tokens),
        contextWindow: finiteNumber(value?.contextWindow),
        percent: finiteNumber(value?.percent),
        sessionCost: trackedSessionCost,
      };
    } catch {
      return trackedSessionCost === undefined
        ? undefined
        : { sessionCost: trackedSessionCost };
    }
  };
  const readAssistantCost = (value: unknown): number | undefined => {
    const message = readRecord(value);
    if (message?.role !== "assistant") return undefined;
    return finiteNumber(readRecord(readRecord(message.usage)?.cost)?.total);
  };
  const calculateSessionCost = (ctx: ExtensionContext): number | undefined => {
    let total = 0;
    try {
      for (const entryValue of ctx.sessionManager.getBranch()) {
        const entry = readRecord(entryValue);
        if (entry?.type !== "message") continue;
        const message = readRecord(entry.message);
        if (message?.role !== "assistant") continue;
        const cost = readAssistantCost(message);
        if (cost === undefined || cost < 0) return undefined;
        total += cost;
      }
      return total;
    } catch {
      return undefined;
    }
  };
  const sessionState = (ctx: ExtensionContext): JsonRecord => {
    const model = ctx.model as unknown as JsonRecord | undefined;
    return {
      sessionId: safeCall(() => ctx.sessionManager.getSessionId()),
      sessionFile: safeCall(() => ctx.sessionManager.getSessionFile()),
      sessionName: safeCall(() => ctx.sessionManager.getSessionName()),
      leafId: safeCall(() => ctx.sessionManager.getLeafId()),
      idle: safeCall(() => ctx.isIdle()) ?? true,
      model: model
        ? {
            provider: stringValue(model.provider),
            id: stringValue(model.id),
            contextWindow: finiteNumber(model.contextWindow),
          }
        : undefined,
      thinkingLevel: safeCall(() => pi.getThinkingLevel()),
      contextUsage: contextUsage(ctx),
    };
  };
  const publishState = (
    ctx: ExtensionContext,
    updateRegistration = false,
  ): void => {
    publish({ ...base("session_state"), state: sessionState(ctx) });
    if (updateRegistration) void writeRegistration(ctx);
  };
  const publishSnapshot = (ctx: ExtensionContext): void => {
    let entries: unknown[] = [];
    try {
      entries = ctx.sessionManager.getBranch();
    } catch {
      /* old Pi */
    }
    const sanitized = sanitizeSnapshotEntries(entries);
    const sequenceCovered = sequence;
    publish({
      ...base("session_snapshot"),
      entries: sanitized,
      leafId: safeCall(() => ctx.sessionManager.getLeafId()),
      sequenceCovered,
    });
  };
  const writeRegistration = async (ctx: ExtensionContext): Promise<void> => {
    if (stopped || !server) return;
    const address = server.address();
    if (!address || typeof address === "string") return;
    const state = sessionState(ctx);
    const registration = {
      protocolVersion: PROTOCOL_VERSION,
      bridgeId,
      instanceId,
      token,
      port: address.port,
      pid: process.pid,
      cwd: ctx.cwd,
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      sessionName: state.sessionName,
      updatedAt: new Date().toISOString(),
    };
    registrationWrites = registrationWrites.then(async () => {
      const directory = path.dirname(registrationPath);
      const temporaryPath = `${registrationPath}.${process.pid}.${instanceId}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(
          temporaryPath,
          JSON.stringify(registration),
          { encoding: "utf8", mode: 0o600 },
        );
        try {
          await fs.promises.rename(temporaryPath, registrationPath);
        } catch {
          await fs.promises.rm(registrationPath, { force: true });
          await fs.promises.rename(temporaryPath, registrationPath);
        }
      } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
        publish({
          ...base("bridge_error"),
          code: "registration_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    await registrationWrites;
  };
  const hello = (client: Client, ctx: ExtensionContext): void => {
    write(client, {
      ...base("hello"),
      instanceId,
      pid: process.pid,
      cwd: ctx.cwd,
      userInputWaits: [...activeUserInputWaits.values()],
      ...sessionState(ctx),
    });
    // Replay raw inputs that happened while qcode was disconnected before the
    // snapshot so its optimistic outbox can correlate without a duplicate.
    for (const input of pendingUserInputEvents.splice(0)) {
      write(client, {
        ...base("user_input"),
        text: input.text,
        source: input.source,
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {}),
      });
    }
    publishSnapshot(ctx);
    if (compatibilityError) {
      write(client, {
        ...base("bridge_error"),
        code: "incompatible_pi",
        message: compatibilityError,
      });
    }
  };

  const handleCommand = (client: Client, value: unknown): void => {
    const record = readRecord(value);
    const requestId = stringValue(record?.requestId) || "unknown";
    if (!record || !stringValue(record.type) || requestId === "unknown") {
      ack(
        client,
        requestId,
        false,
        "invalid_command",
        "Command must include type and requestId.",
      );
      return;
    }
    if (record.protocolVersion !== PROTOCOL_VERSION) {
      ack(
        client,
        requestId,
        false,
        "incompatible_protocol",
        `Bridge protocol ${String(record.protocolVersion)} is unsupported. Update pi-qcode.`,
      );
      return;
    }
    if (!client.authenticated) {
      if (record.type !== "authenticate" || record.token !== token) {
        ack(
          client,
          requestId,
          false,
          "authentication_failed",
          "Bridge authentication failed.",
        );
        client.socket.end();
        return;
      }
      client.authenticated = true;
      if (activeClient && activeClient !== client) activeClient.socket.end();
      activeClient = client;
      ack(client, requestId, true);
      if (currentContext) hello(client, currentContext);
      return;
    }
    const previousOutcome = processState.requestOutcomes.get(
      `${bridgeId}:${requestId}`,
    );
    if (previousOutcome) {
      ack(
        client,
        requestId,
        previousOutcome.ok,
        previousOutcome.code,
        previousOutcome.message,
      );
      return;
    }
    if (record.type === "ping") {
      ackAndRemember(client, requestId, { ok: true });
      return;
    }
    if (record.type === "request_snapshot") {
      if (!currentContext) {
        ackAndRemember(client, requestId, {
          ok: false,
          code: "session_unavailable",
          message: "Pi session is not ready.",
        });
      } else {
        ackAndRemember(client, requestId, { ok: true });
        publishSnapshot(currentContext);
      }
      return;
    }
    if (record.type === "send_user_message") {
      const text = typeof record.text === "string" ? record.text : "";
      const clientMessageId = stringValue(record.clientMessageId) || "";
      if (!clientMessageId) {
        ackAndRemember(client, requestId, {
          ok: false,
          code: "invalid_message",
          message: "Client message ID is required.",
        });
        return;
      }
      if (!text.trim()) {
        ackAndRemember(client, requestId, {
          ok: false,
          code: "invalid_message",
          message: "Message text cannot be empty.",
        });
        return;
      }
      if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
        ackAndRemember(client, requestId, {
          ok: false,
          code: "message_too_large",
          message: `Message exceeds ${MAX_MESSAGE_BYTES} bytes.`,
        });
        return;
      }
      if (record.delivery !== "steer") {
        ackAndRemember(client, requestId, {
          ok: false,
          code: "invalid_delivery",
          message: "Only steer delivery is supported.",
        });
        return;
      }
      const clientCacheKey = `${bridgeId}:${clientMessageId}`;
      if (processState.acceptedClientMessageIds.has(clientCacheKey)) {
        ackAndRemember(client, requestId, { ok: true });
        return;
      }
      const ctx = currentContext;
      if (!ctx) {
        ackAndRemember(client, requestId, {
          ok: false,
          code: "session_unavailable",
          message: "Pi session is not ready.",
        });
        return;
      }
      const correlation = { clientMessageId, text };
      correlatedInputs.push(correlation);
      try {
        if (ctx.isIdle()) pi.sendUserMessage(text);
        else pi.sendUserMessage(text, { deliverAs: "steer" });
        rememberBounded(
          processState.acceptedClientMessageIds,
          clientCacheKey,
          true,
        );
        ackAndRemember(client, requestId, { ok: true });
      } catch (error) {
        const index = correlatedInputs.indexOf(correlation);
        if (index !== -1) correlatedInputs.splice(index, 1);
        ackAndRemember(client, requestId, {
          ok: false,
          code: "send_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    ack(
      client,
      requestId,
      false,
      "unknown_command",
      `Unknown bridge command: ${String(record.type)}`,
    );
  };

  pi.on("session_start", async (event, ctx) => {
    currentContext = ctx;
    stopped = false;
    currentRunId = undefined;
    currentRunStartedAt = undefined;
    trackedSessionCost = calculateSessionCost(ctx);
    correlatedInputs.length = 0;
    activeUserInputWaits.clear();
    initialInputEligible =
      event.reason === "startup" &&
      Boolean(initialClientMessageId) &&
      !processState.consumedInitialBridgeIds.has(bridgeId);
    appendLifecycle("session_start", "idle", { sessionReason: event.reason });
    compatibilityError =
      typeof pi.sendUserMessage !== "function" ||
      typeof ctx.getContextUsage !== "function"
        ? "This Pi version is incompatible with qcode bridge. Try updating Pi or Qcode."
        : undefined;
    server = net.createServer((socket) => {
      socket.setNoDelay(true);
      const client: Client = {
        socket,
        authenticated: false,
        decoder: new LineDecoder(),
      };
      clients.add(client);
      const authenticationTimer = setTimeout(() => {
        if (!client.authenticated) socket.destroy();
      }, 5000);
      socket.on("data", (chunk) =>
        client.decoder.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
          (record) => handleCommand(client, record),
          (code, message) => {
            write(client, { ...base("bridge_error"), code, message });
            if (code === "record_too_large") socket.destroy();
          },
        ),
      );
      socket.on("close", () => {
        clearTimeout(authenticationTimer);
        clients.delete(client);
        if (activeClient === client) activeClient = undefined;
      });
      socket.on("error", () => {});
    });
    server.on("error", (error) =>
      publish({
        ...base("bridge_error"),
        code: "server_error",
        message: error.message,
      }),
    );
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    await writeRegistration(ctx);
  });

  pi.events.on("pi-lifecycle", (value) => {
    const event = readRecord(value);
    const eventName = stringValue(event?.event);
    const waitId = stringValue(event?.waitId);
    if (
      event?.version !== 1 ||
      !waitId ||
      (eventName !== "user_input_wait_start" &&
        eventName !== "user_input_wait_end")
    ) return;

    if (eventName === "user_input_wait_start") {
      const message = truncateText(stringValue(event.message) || "", 4 * 1024) || undefined;
      activeUserInputWaits.set(waitId, { waitId, ...(message ? { message } : {}) });
      publish({
        ...base("user_input_wait_start"),
        waitId,
        ...(message ? { message } : {}),
      });
      return;
    }

    const activeWait = activeUserInputWaits.get(waitId);
    activeUserInputWaits.delete(waitId);
    publish({
      ...base("user_input_wait_end"),
      waitId,
      ...(activeWait?.message ? { message: activeWait.message } : {}),
    });
  });

  pi.on("input", (event) => {
    let clientMessageId: string | undefined;
    if (initialInputEligible && initialClientMessageId) {
      initialInputEligible = false;
      processState.consumedInitialBridgeIds.add(bridgeId);
      clientMessageId = initialClientMessageId;
    } else if (event.source === "extension" && correlatedInputs.length) {
      const matchingIndex = correlatedInputs.findIndex(
        (item) => item.text === event.text,
      );
      const index = matchingIndex === -1 ? 0 : matchingIndex;
      clientMessageId = correlatedInputs.splice(index, 1)[0]?.clientMessageId;
    }
    const input = {
      text: event.text,
      source: event.source,
      ...(clientMessageId ? { clientMessageId } : {}),
    };
    if (activeClient?.authenticated) {
      publish({ ...base("user_input"), ...input });
    } else {
      pendingUserInputEvents.push(input);
      if (pendingUserInputEvents.length > 64) pendingUserInputEvents.shift();
    }
  });
  pi.on("session_info_changed", (_event, ctx) => publishState(ctx, true));
  pi.on("model_select", (_event, ctx) => publishState(ctx, true));
  pi.on("thinking_level_select", (_event, ctx) => publishState(ctx));
  pi.on("session_tree", (_event, ctx) => {
    trackedSessionCost = calculateSessionCost(ctx);
    publishState(ctx);
    publishSnapshot(ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    trackedSessionCost = calculateSessionCost(ctx);
    publish({ ...base("session_compact") });
    publishState(ctx);
    publishSnapshot(ctx);
  });
  pi.on("agent_start", (_event, ctx) => {
    if (!currentRunId) {
      currentRunId = crypto.randomUUID();
      currentRunStartedAt = Date.now();
      appendLifecycle("agent_start", "busy", { runId: currentRunId });
    }
    publish({ ...base("agent_start") });
    publishState(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    activeUserInputWaits.clear();
    const runId = currentRunId;
    const elapsedMs =
      currentRunStartedAt === undefined
        ? undefined
        : Date.now() - currentRunStartedAt;
    if (runId) appendLifecycle("agent_end", "idle", { runId, elapsedMs });
    currentRunId = undefined;
    currentRunStartedAt = undefined;
    publish({ ...base("agent_settled") });
    publishState(ctx, true);
  });
  pi.on("message_start", (event, ctx) => {
    publish({
      ...base("message_start"),
      message: sanitizeMessage(event.message),
    });
    publishState(ctx, true);
  });
  pi.on("message_end", (event, ctx) => {
    const message = event.message as unknown;
    if (readRecord(message)?.role === "assistant") {
      const cost = readAssistantCost(message);
      trackedSessionCost =
        trackedSessionCost !== undefined && cost !== undefined && cost >= 0
          ? trackedSessionCost + cost
          : undefined;
    }
    publish({
      ...base("message_end"),
      message: sanitizeMessage(event.message),
    });
    publishState(ctx, true);
  });
  // message_end can run before Pi's session manager has incorporated the final
  // message. turn_end gives consumers another authoritative context refresh.
  pi.on("turn_end", (_event, ctx) => publishState(ctx));
  pi.on("tool_execution_start", (event) => {
    const skillName = readSkillNameFromToolCall(event.toolName, event.args);
    publish({
      ...base("tool_execution_start"),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      ...(skillName ? { skillName } : {}),
    });
  });
  pi.on("tool_execution_end", (event, ctx) => {
    publish({
      ...base("tool_execution_end"),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
    });
    publishState(ctx);
  });
  pi.on("session_shutdown", async (event) => {
    const runId = currentRunId;
    const elapsedMs =
      currentRunStartedAt === undefined
        ? undefined
        : Date.now() - currentRunStartedAt;
    appendLifecycle("session_shutdown", "idle", {
      ...(runId ? { runId } : {}),
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      shutdownReason: event.reason,
    });
    currentRunId = undefined;
    currentRunStartedAt = undefined;
    activeUserInputWaits.clear();
    publish({ ...base("session_shutdown"), reason: event.reason });
    stopped = true;
    currentContext = undefined;
    for (const client of clients) client.socket.end();
    clients.clear();
    activeClient = undefined;
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = undefined;
    await registrationWrites;
    await removeOwnedRegistration(registrationPath, bridgeId, instanceId);
  });
}

function sanitizeSnapshotEntries(entries: unknown[]): JsonRecord[] {
  const result: JsonRecord[] = [];
  let bytes = 0;
  const candidates = entries.slice(-MAX_SNAPSHOT_ENTRIES);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const entry = sanitizeEntry(candidates[index]);
    if (!entry) continue;
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8") + 1;
    if (bytes + entryBytes > MAX_RECORD_BYTES - 64 * 1024) break;
    result.unshift(entry);
    bytes += entryBytes;
  }
  return result;
}

function sanitizeEntry(value: unknown): JsonRecord | undefined {
  const entry = readRecord(value);
  if (!entry || typeof entry.type !== "string") return undefined;
  const common = {
    type: entry.type,
    id: stringValue(entry.id),
    parentId: entry.parentId === null ? null : stringValue(entry.parentId),
    timestamp:
      typeof entry.timestamp === "string" || typeof entry.timestamp === "number"
        ? entry.timestamp
        : undefined,
  };
  if (entry.type === "message")
    return { ...common, message: sanitizeMessage(entry.message) };
  if (entry.type === "model_change")
    return {
      ...common,
      provider: stringValue(entry.provider),
      modelId: stringValue(entry.modelId),
    };
  if (entry.type === "thinking_level_change")
    return { ...common, thinkingLevel: stringValue(entry.thinkingLevel) };
  if (entry.type === "session_info")
    return { ...common, name: truncateText(stringValue(entry.name) || "") };
  if (entry.type === "compaction")
    return {
      ...common,
      summary: truncateText(stringValue(entry.summary) || ""),
      firstKeptEntryId: stringValue(entry.firstKeptEntryId),
      tokensBefore: finiteNumber(entry.tokensBefore),
    };
  if (entry.type === "branch_summary")
    return {
      ...common,
      summary: truncateText(stringValue(entry.summary) || ""),
      fromId: stringValue(entry.fromId),
    };
  if (entry.type === "custom" && entry.customType === "pi-lifecycle")
    return {
      ...common,
      customType: "pi-lifecycle",
      data: sanitizeLifecycleData(entry.data),
    };
  return common;
}

function sanitizeMessage(value: unknown): JsonRecord {
  const message = readRecord(value) || {};
  const role = stringValue(message.role) || "message";
  const result: JsonRecord = {
    role,
    timestamp: finiteNumber(message.timestamp),
  };
  if (role === "user" || role === "assistant") {
    result.content = sanitizeContent(message.content, MAX_TEXT_BYTES);
  }
  if (role === "assistant") {
    result.provider = stringValue(message.provider);
    result.model = stringValue(message.model);
    result.stopReason = stringValue(message.stopReason);
    result.errorMessage = truncateText(
      stringValue(message.errorMessage) || "",
      16 * 1024,
    );
    result.usage = sanitizeUsage(message.usage);
  }
  if (role === "toolResult") {
    result.toolCallId = stringValue(message.toolCallId);
    result.toolName = stringValue(message.toolName);
    result.isError = Boolean(message.isError);
  }
  return result;
}

function sanitizeContent(value: unknown, textLimit: number): unknown {
  if (typeof value === "string") return truncateText(value, textLimit);
  if (!Array.isArray(value)) return [];
  const result: JsonRecord[] = [];
  let remainingTextBytes = textLimit;
  for (const item of value.slice(0, 256)) {
    const block = readRecord(item);
    if (!block) continue;
    if (block.type === "text") {
      if (remainingTextBytes <= 0) continue;
      const text = truncateText(
        stringValue(block.text) || "",
        remainingTextBytes,
      );
      remainingTextBytes -= Buffer.byteLength(text, "utf8");
      result.push({ type: "text", text });
    } else if (block.type === "thinking") {
      result.push({ type: "thinking", thinking: "[thinking omitted]" });
    } else if (block.type === "toolCall") {
      const toolName = stringValue(block.name) || "tool";
      const skillName = readSkillNameFromToolCall(toolName, block.arguments);
      result.push({
        type: "toolCall",
        id: stringValue(block.id),
        name: toolName,
        ...(skillName ? { skillName } : {}),
      });
    } else if (block.type === "image") {
      result.push({ type: "image", omitted: true });
    }
  }
  return result;
}

function readSkillNameFromToolCall(
  toolName: string,
  args: unknown,
): string | undefined {
  if (toolName !== "read" && !toolName.endsWith(".read")) return undefined;
  const filePath = stringValue(readRecord(args)?.path);
  return filePath?.match(/(?:^|[/\\])([^/\\]+)[/\\]SKILL\.md$/)?.[1];
}

function sanitizeLifecycleData(value: unknown): JsonRecord {
  const data = readRecord(value) || {};
  return {
    extension: data.extension === "pi-lifecycle" ? "pi-lifecycle" : undefined,
    version: finiteNumber(data.version),
    event: stringValue(data.event),
    state: stringValue(data.state),
    timestamp: finiteNumber(data.timestamp),
    pid: finiteNumber(data.pid),
    runId: stringValue(data.runId),
    sessionReason: stringValue(data.sessionReason),
    shutdownReason: stringValue(data.shutdownReason),
    elapsedMs: finiteNumber(data.elapsedMs),
  };
}

function sanitizeUsage(value: unknown): JsonRecord | undefined {
  const usage = readRecord(value);
  if (!usage) return undefined;
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    totalTokens: finiteNumber(usage.totalTokens),
    cost: { total: finiteNumber(readRecord(usage.cost)?.total) },
  };
}

async function removeOwnedRegistration(
  filePath: string,
  bridgeId: string,
  instanceId: string,
): Promise<void> {
  try {
    const value = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    if (
      value?.bridgeId === bridgeId &&
      value?.instanceId === instanceId &&
      value?.pid === process.pid
    ) {
      await fs.promises.rm(filePath, { force: true });
    }
  } catch {
    /* already removed/replaced */
  }
}

function rememberBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > IDEMPOTENCY_CACHE_SIZE) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function readRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
function truncateText(value: string, maxBytes = MAX_TEXT_BYTES): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes)
    end = Math.floor(end * 0.9);
  return `${value.slice(0, end)}\n[truncated by qcode bridge]`;
}
