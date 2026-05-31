import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";

export interface RecentSession {
  id: string;
  cwd: string;
  model: string;
  messageCount: number;
  totalTokens: number;
  filePath: string;
  fileName: string;
  title: string;
  preview: string;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface SessionMessage {
  role: string;
  text: string;
  kind?: "message" | "thinking";
  counts?: Record<string, number>;
}

export interface ContextUsage {
  usedTokens?: number;
  contextWindow?: number;
  percent?: number;
  modelId?: string;
  provider?: string;
  thinkingLevel?: string;
  sessionCost?: number;
}

interface SessionMessageState {
  lastRenderedWasUser: boolean;
  thinkingCounts: Record<string, number>;
  visibleMessages: SessionMessage[];
  contextUsage?: ContextUsage;
  modelId?: string;
  provider?: string;
  thinkingLevel?: string;
  sessionCost: number;
}

export interface SessionDetail {
  title: string;
  filePath?: string;
  fileSize?: number;
  messages: SessionMessage[];
  contextUsage?: ContextUsage;
  messageState?: SessionMessageState;
  error?: string;
}

export interface SessionFileSnapshot {
  filePath: string;
  createdAtMs: number;
}

export function getRecentSessions(workspaceCwd?: string): RecentSession[] {
  return getSessionFiles()
    .map(parseSessionFile)
    .filter((session): session is RecentSession => Boolean(session))
    .filter((session) => !workspaceCwd || isSameCwd(session.cwd, workspaceCwd))
    .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
    .slice(0, 50);
}

export function readSessionDetail(filePath: string): SessionDetail {
  if (!filePath) {
    return {
      title: "Session Detail",
      messages: [],
      error: "No session file was provided.",
    };
  }

  if (!isSessionFile(filePath)) {
    return {
      title: "Session Detail",
      messages: [],
      error: "The requested session file is not valid.",
    };
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const messageState = readSessionMessageState(content);
    return {
      title: path.basename(filePath),
      filePath,
      fileSize: Buffer.byteLength(content, "utf8"),
      messages: messageState.visibleMessages,
      contextUsage: messageState.contextUsage,
      messageState,
    };
  } catch {
    return {
      title: path.basename(filePath),
      messages: [],
      error: "Unable to read the requested session file.",
    };
  }
}

export function watchSessionDetail(
  session: SessionDetail,
  webview: vscode.Webview,
): vscode.Disposable | undefined {
  if (session.error || !session.filePath || !fs.existsSync(session.filePath)) {
    return undefined;
  }

  return createSessionFileWatcher(
    session.filePath,
    session.fileSize ?? 0,
    session.messageState ?? createEmptySessionMessageState(),
    (messages, contextUsage) => {
      webview.postMessage({ command: "replaceMessages", messages, contextUsage });
    },
  );
}

export function isSessionFile(filePath: string): boolean {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedSessionsDir = path.resolve(getSessionsDir());
  return (
    resolvedFilePath.startsWith(`${resolvedSessionsDir}${path.sep}`) &&
    resolvedFilePath.endsWith(".jsonl")
  );
}

export function getSessionsDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "sessions");
}

export function getSessionFolderForCwd(cwd: string): string {
  return path.join(getSessionsDir(), getSessionFolderName(cwd));
}

export function getNewestSessionFileForCwd(cwd: string): SessionFileSnapshot | undefined {
  const sessionFolder = getSessionFolderForCwd(cwd);
  if (!fs.existsSync(sessionFolder)) return undefined;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sessionFolder, { withFileTypes: true });
  } catch {
    return undefined;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => snapshotSessionFile(path.join(sessionFolder, entry.name)))
    .filter((snapshot): snapshot is SessionFileSnapshot => Boolean(snapshot))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
}

function hasFinalPhase(value: unknown): boolean {
  if (typeof value === "string") {
    if (!value.includes('"phase"')) return false;

    try {
      return hasFinalPhase(JSON.parse(value));
    } catch {
      return false;
    }
  }

  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasFinalPhase);

  const record = value as Record<string, unknown>;
  return (
    record.phase === "final" ||
    record.phase === "final_answer" ||
    Object.values(record).some(hasFinalPhase)
  );
}

interface UsageRecord {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  costTotal?: number;
}

function readText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readUsage(value: unknown): UsageRecord | undefined {
  const usage = readRecord(value);
  if (!usage) return undefined;

  return {
    input: readPositiveNumber(usage.input),
    output: readPositiveNumber(usage.output),
    cacheRead: readPositiveNumber(usage.cacheRead),
    cacheWrite: readPositiveNumber(usage.cacheWrite),
    totalTokens: readPositiveNumber(usage.totalTokens),
    costTotal: readPositiveNumber(readRecord(usage.cost)?.total),
  };
}

function readPositiveNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function calculateUsageTokens(usage: UsageRecord): number {
  return Math.round(
    usage.totalTokens ??
      (usage.input ?? 0) +
        (usage.output ?? 0) +
        (usage.cacheRead ?? 0) +
        (usage.cacheWrite ?? 0),
  );
}

function getSessionFolderName(cwd: string): string {
  const translatedCwd = cwd.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "-");
  return `--${translatedCwd}--`;
}

function isSameCwd(sessionCwd: string, workspaceCwd: string): boolean {
  if (!sessionCwd) return false;
  return path.resolve(sessionCwd) === path.resolve(workspaceCwd);
}

function snapshotSessionFile(filePath: string): SessionFileSnapshot | undefined {
  try {
    const stat = fs.statSync(filePath);
    return {
      filePath,
      createdAtMs: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs,
    };
  } catch {
    return undefined;
  }
}

function getSessionFiles(): string[] {
  const files: string[] = [];
  walk(getSessionsDir(), files);
  return files;
}

function walk(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
  }
}

function parseSessionFile(filePath: string): RecentSession | null {
  try {
    const stat = fs.statSync(filePath);
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line.trim());

    let id = path.basename(filePath);
    let cwd = "";
    let model = "unknown";
    let messageCount = 0;
    let firstUserMessage = "";
    let latestUserMessage = "";
    let totalTokens = 0;
    let createdAt = stat.birthtime;
    let lastActiveAt = stat.mtime;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const timestamp = entry.timestamp ? new Date(entry.timestamp) : undefined;
        if (timestamp && !Number.isNaN(timestamp.getTime())) {
          if (timestamp < createdAt) createdAt = timestamp;
          if (timestamp > lastActiveAt) lastActiveAt = timestamp;
        }

        if (entry.type === "session") {
          id = String(entry.id || id);
          cwd = String(entry.cwd || cwd);
          if (timestamp) createdAt = timestamp;
        }

        if (entry.type === "model_change" && entry.modelId && model === "unknown") {
          model = String(entry.modelId);
        }

        if (entry.type === "message" && entry.message) {
          if (entry.message.role === "user") {
            const text = readText(entry.message.content);
            if (text && !text.startsWith("You are running inside VS Code")) {
              const preview = text.slice(0, 160).replace(/\s+/g, " ").trim();
              if (!firstUserMessage) firstUserMessage = preview;
              latestUserMessage = preview;
            }
          }

          if (entry.message.role === "assistant") {
            messageCount += 1;
            const usage = readUsage(entry.message.usage) ?? readUsage(entry.usage);
            const usageTokens = usage ? calculateUsageTokens(usage) : 0;
            if (usageTokens) totalTokens += usageTokens;
          }
        }
      } catch {
        // Ignore malformed JSONL rows.
      }
    }

    return {
      id,
      cwd,
      model,
      messageCount,
      totalTokens,
      filePath,
      fileName: path.basename(filePath),
      title: firstUserMessage || path.basename(filePath),
      preview: latestUserMessage || firstUserMessage || "(no messages yet)",
      createdAt,
      lastActiveAt,
    };
  } catch {
    return null;
  }
}

function readSessionMessageState(content: string): SessionMessageState {
  const state = createEmptySessionMessageState();

  for (const line of content.split(/\r\n|\r|\n/)) {
    updateSessionMessageState(state, line);
  }

  return state;
}

function createEmptySessionMessageState(): SessionMessageState {
  return {
    lastRenderedWasUser: false,
    thinkingCounts: {},
    visibleMessages: [],
    contextUsage: undefined,
    modelId: undefined,
    provider: undefined,
    thinkingLevel: undefined,
    sessionCost: 0,
  };
}

function updateSessionMessageState(state: SessionMessageState, line: string): boolean {
  const entry = readSessionEntry(line);
  if (!entry) return false;

  const contextChanged = updateSessionContextUsage(state, entry);
  const message = readRenderableSessionMessage(entry);
  if (message) {
    removeThinkingMessage(state.visibleMessages);
    state.visibleMessages.push(message);
    state.lastRenderedWasUser = message.role === "user";
    state.thinkingCounts = {};
    if (state.lastRenderedWasUser) {
      upsertThinkingMessage(state.visibleMessages, state.thinkingCounts);
    }
    return true;
  }

  if (!state.lastRenderedWasUser) return contextChanged;

  incrementThinkingCount(state.thinkingCounts, getEntryType(entry));
  upsertThinkingMessage(state.visibleMessages, state.thinkingCounts);
  return true;
}

function readSessionEntry(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;

  try {
    const entry = JSON.parse(line);
    return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function updateSessionContextUsage(
  state: SessionMessageState,
  entry: Record<string, unknown>,
): boolean {
  const before = serializeContextUsage(state.contextUsage);
  const entryType = typeof entry.type === "string" ? entry.type : "";

  if (entryType === "model_change") {
    const modelId = typeof entry.modelId === "string" ? entry.modelId : state.modelId;
    const provider = typeof entry.provider === "string" ? entry.provider : state.provider;
    updateSessionModel(state, provider, modelId);
  }

  if (entryType === "thinking_level_change") {
    const thinkingLevel = typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : undefined;
    updateThinkingLevel(state, thinkingLevel);
  }

  if (entryType === "compaction") {
    state.contextUsage = buildContextUsage(state);
  }

  if (entryType === "message") {
    const message = readRecord(entry.message);
    if (message?.role === "assistant") {
      const provider = typeof message.provider === "string" ? message.provider : state.provider;
      const modelId = typeof message.model === "string" ? message.model : state.modelId;
      updateSessionModel(state, provider, modelId);

      const usage = readUsage(message.usage) ?? readUsage(entry.usage);
      const usedTokens = usage ? calculateUsageTokens(usage) : 0;
      if (usage?.costTotal) state.sessionCost += usage.costTotal;
      if (usedTokens > 0 || usage?.costTotal) {
        state.contextUsage = buildContextUsage(
          state,
          usedTokens > 0 ? usedTokens : state.contextUsage?.usedTokens,
        );
      }
    }
  }

  return serializeContextUsage(state.contextUsage) !== before;
}

function updateSessionModel(
  state: SessionMessageState,
  provider: string | undefined,
  modelId: string | undefined,
): void {
  if (provider) state.provider = provider;
  if (modelId) state.modelId = modelId;

  if (state.contextUsage) {
    state.contextUsage = buildContextUsage(state, state.contextUsage.usedTokens);
  } else if (state.modelId) {
    state.contextUsage = buildContextUsage(state);
  }
}

function updateThinkingLevel(
  state: SessionMessageState,
  thinkingLevel: string | undefined,
): void {
  if (thinkingLevel) state.thinkingLevel = thinkingLevel;

  if (state.contextUsage) {
    state.contextUsage = buildContextUsage(state, state.contextUsage.usedTokens);
  } else if (state.thinkingLevel) {
    state.contextUsage = buildContextUsage(state);
  }
}

function buildContextUsage(
  state: SessionMessageState,
  usedTokens?: number,
): ContextUsage | undefined {
  const contextWindow = state.modelId
    ? resolveModelContextWindow(state.provider, state.modelId)
    : undefined;
  const percent = usedTokens !== undefined && contextWindow
    ? (usedTokens / contextWindow) * 100
    : undefined;

  if (
    !state.modelId &&
    !state.thinkingLevel &&
    usedTokens === undefined &&
    contextWindow === undefined &&
    state.sessionCost <= 0
  ) {
    return undefined;
  }

  return {
    usedTokens,
    contextWindow,
    percent,
    modelId: state.modelId,
    provider: state.provider,
    thinkingLevel: state.thinkingLevel,
    sessionCost: state.sessionCost > 0 ? state.sessionCost : undefined,
  };
}

function serializeContextUsage(usage: ContextUsage | undefined): string {
  return JSON.stringify(usage ?? null);
}

function readRenderableSessionMessage(entry: Record<string, unknown>): SessionMessage | null {
  const messageEntry = entry.message;
  if (entry.type !== "message" || !messageEntry || typeof messageEntry !== "object") return null;

  const message = messageEntry as Record<string, unknown>;
  const role = String(message.role || "message");
  if (role !== "user" && !hasFinalPhase(entry)) return null;

  const text = readText(message.content);
  if (!text) return null;

  return {
    role,
    text,
    kind: "message",
  };
}

function getEntryType(entry: Record<string, unknown>): string {
  const entryType = typeof entry.type === "string" ? entry.type : "unknown";
  if (entryType !== "message") return entryType;

  const message = entry.message;
  if (!message || typeof message !== "object") return "message";

  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? `message.${role}` : "message";
}

function incrementThinkingCount(counts: Record<string, number>, entryType: string): void {
  counts[entryType] = (counts[entryType] || 0) + 1;
}

function upsertThinkingMessage(
  visibleMessages: SessionMessage[],
  counts: Record<string, number>,
): void {
  removeThinkingMessage(visibleMessages);
  const thinkingMessage = createThinkingMessage(counts);
  if (thinkingMessage) visibleMessages.push(thinkingMessage);
}

function removeThinkingMessage(visibleMessages: SessionMessage[]): void {
  if (visibleMessages.at(-1)?.kind === "thinking") {
    visibleMessages.pop();
  }
}

function formatThinkingEntryType(entryType: string): string {
  return entryType.startsWith("message.") ? entryType.slice("message.".length) : entryType;
}

function createThinkingMessage(counts: Record<string, number>): SessionMessage | null {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  const text = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entryType, count]) => `${formatThinkingEntryType(entryType)}: ${count}`)
    .join("\n");

  return {
    role: "thinking",
    kind: "thinking",
    text,
    counts: { ...counts },
  };
}

const modelContextWindowCache = new Map<string, number | undefined>();

const knownContextWindows: Record<string, number> = {
  "gpt-5.5": 272_000,
  "gpt-5.3-codex-spark": 128_000,
  "gpt-5.2": 400_000,
  "gpt-5.1": 400_000,
  "gpt-5": 400_000,
  "gpt-4.1": 1_000_000,
  "gpt-4.1-mini": 1_000_000,
  "gpt-4.1-nano": 1_000_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-opus-4": 200_000,
  "claude-3-7-sonnet": 200_000,
  "gemini-3-pro-preview": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
};

function resolveModelContextWindow(
  provider: string | undefined,
  modelId: string,
): number | undefined {
  const cacheKey = `${provider || ""}/${modelId}`;
  if (modelContextWindowCache.has(cacheKey)) {
    return modelContextWindowCache.get(cacheKey);
  }

  const contextWindow =
    readCustomModelContextWindow(provider, modelId) ??
    readPiModelContextWindow(provider, modelId) ??
    knownContextWindows[modelId];
  modelContextWindowCache.set(cacheKey, contextWindow);
  return contextWindow;
}

function readCustomModelContextWindow(
  provider: string | undefined,
  modelId: string,
): number | undefined {
  const modelsPath = path.join(os.homedir(), ".pi", "agent", "models.json");
  if (!fs.existsSync(modelsPath)) return undefined;

  try {
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(modelsPath, "utf8")));
    const providers = readRecord(parsed.providers);
    const providerEntries = provider
      ? [[provider, providers?.[provider]]]
      : Object.entries(providers ?? {});

    for (const [, providerValue] of providerEntries) {
      const providerConfig = readRecord(providerValue);
      const models = providerConfig?.models;
      if (!Array.isArray(models)) continue;

      for (const model of models) {
        const modelConfig = readRecord(model);
        const id = modelConfig?.id;
        if (id === modelId) return readPositiveNumber(modelConfig?.contextWindow);
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readPiModelContextWindow(
  provider: string | undefined,
  modelId: string,
): number | undefined {
  try {
    const output = execFileSync("pi", ["--list-models", modelId], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    });

    for (const line of output.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 3 || columns[0] === "provider") continue;
      if (provider && columns[0] !== provider) continue;
      if (columns[1] === modelId) return parseTokenCount(columns[2]);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parseTokenCount(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return undefined;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;

  const suffix = (match[2] || "").toUpperCase();
  const multiplier = suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  return Math.round(base * multiplier);
}

function stripJsonComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

function createSessionFileWatcher(
  filePath: string,
  startPosition: number,
  messageState: SessionMessageState,
  onMessages: (messages: SessionMessage[], contextUsage?: ContextUsage) => void,
): vscode.Disposable | undefined {
  let disposed = false;
  let offset = startPosition;
  let pendingText = "";

  const readAppendedLines = () => {
    if (disposed) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    if (stat.size < offset) {
      offset = stat.size;
      pendingText = "";
    }

    if (stat.size === offset) return;

    let fd: number | undefined;
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buffer, 0, length, offset);
      offset = stat.size;

      const text = pendingText + buffer.toString("utf8");
      const lines = text.split(/\r\n|\r|\n/);
      pendingText = /\r\n$|\r$|\n$/.test(text) ? "" : lines.pop() || "";

      const changed = lines.reduce(
        (didChange, line) => updateSessionMessageState(messageState, line) || didChange,
        false,
      );
      if (changed) onMessages(messageState.visibleMessages, messageState.contextUsage);
    } catch {
      // Ignore transient reads while the session file is being appended.
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors.
        }
      }
    }
  };

  let readTimer: NodeJS.Timeout | undefined;
  const scheduleRead = () => {
    if (readTimer) return;
    readTimer = setTimeout(() => {
      readTimer = undefined;
      readAppendedLines();
    }, 50);
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
      if (eventType === "change") scheduleRead();
    });
  } catch {
    return undefined;
  }

  scheduleRead();

  return {
    dispose() {
      disposed = true;
      if (readTimer) clearTimeout(readTimer);
      watcher.close();
    },
  };
}
