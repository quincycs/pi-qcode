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

interface SessionFileCandidate {
  filePath: string;
  mtimeMs: number;
}

const RECENT_SESSION_LIMIT = 50;

export function getRecentSessions(workspaceCwd?: string): RecentSession[] {
  return getRecentSessionFileCandidates(workspaceCwd)
    .slice(0, RECENT_SESSION_LIMIT)
    .map((candidate) => parseSessionFile(candidate.filePath))
    .filter((session): session is RecentSession => Boolean(session))
    .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
    .slice(0, RECENT_SESSION_LIMIT);
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

function readText(
  content: unknown,
  options: { collapseSkillContent?: boolean } = {},
): string {
  if (typeof content === "string") {
    return options.collapseSkillContent ? collapseSkillContent(content) : content;
  }
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => {
      const text = item.text as string;
      return options.collapseSkillContent ? collapseSkillContent(text) : text;
    })
    .join("\n");
}

function collapseSkillContent(text: string): string {
  const trimmedText = text.trim();
  if (!trimmedText.endsWith("</skill>")) return text;

  const match = trimmedText.match(/^<skill\s+name=(['"])([^'"]+)\1(?:\s|>)/);
  const skillName = match?.[2]?.trim();
  return skillName ? `/skill:${skillName}` : text;
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
  const translatedCwd = path
    .resolve(cwd)
    .replace(/^[\\/]/, "")
    .replace(/[\\/:]/g, "-");
  return `--${translatedCwd}--`;
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

function getRecentSessionFileCandidates(
  workspaceCwd?: string,
): SessionFileCandidate[] {
  const candidates = workspaceCwd
    ? listSessionFileCandidatesInDir(getSessionFolderForCwd(workspaceCwd))
    : getAllSessionFileCandidates();

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function getAllSessionFileCandidates(): SessionFileCandidate[] {
  const files: SessionFileCandidate[] = [];
  walk(getSessionsDir(), files);
  return files;
}

function walk(dir: string, files: SessionFileCandidate[]): void {
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
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const candidate = readSessionFileCandidate(fullPath);
      if (candidate) files.push(candidate);
    }
  }
}

function listSessionFileCandidatesInDir(dir: string): SessionFileCandidate[] {
  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => readSessionFileCandidate(path.join(dir, entry.name)))
    .filter((candidate): candidate is SessionFileCandidate => Boolean(candidate));
}

function readSessionFileCandidate(filePath: string): SessionFileCandidate | undefined {
  try {
    const stat = fs.statSync(filePath);
    return {
      filePath,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return undefined;
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
            const text = readText(entry.message.content, { collapseSkillContent: true });
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

  incrementThinkingCounts(state.thinkingCounts, getThinkingEntryCounts(entry));
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
  const errorMessage = role === "assistant" ? readAssistantErrorMessage(message, entry) : "";
  if (role !== "user" && !errorMessage && !isCompleteAssistantMessage(message, entry)) return null;

  const text = errorMessage || readText(message.content, {
    collapseSkillContent: role === "user",
  });
  if (!text) return null;

  return {
    role,
    text,
    kind: "message",
  };
}

// An assistant message is considered complete if any provider signal indicates it finished
// successfully. Different providers/versions use different conventions, so we check all
// known signals additively — any one match is sufficient.
function isCompleteAssistantMessage(
  message: Record<string, unknown>,
  entry: Record<string, unknown>,
): boolean {
  // Convention 1 (openai / some providers): a `phase` field set to "final" or "final_answer"
  // somewhere in the entry tree.
  if (hasFinalPhase(entry)) return true;

  // Convention 2 (openrouter / most providers): a `stopReason` field is present (any value means the
  // message is complete — error/aborted are still worth showing).
  const stopReason = typeof message.stopReason === "string"
    ? message.stopReason
    : typeof entry.stopReason === "string"
      ? entry.stopReason
      : "";
  if (stopReason) return true;

  return false;
}

function readAssistantErrorMessage(
  message: Record<string, unknown>,
  entry: Record<string, unknown>,
): string {
  const stopReason = typeof message.stopReason === "string"
    ? message.stopReason
    : typeof entry.stopReason === "string"
      ? entry.stopReason
      : "";
  if (stopReason !== "error" && stopReason !== "aborted") return "";

  const errorMessage = typeof message.errorMessage === "string"
    ? message.errorMessage
    : typeof entry.errorMessage === "string"
      ? entry.errorMessage
      : "";
  return errorMessage.trim();
}

function getThinkingEntryCounts(entry: Record<string, unknown>): Record<string, number> {
  const toolCallCounts = readAssistantToolCallCounts(entry);
  if (Object.keys(toolCallCounts).length) return toolCallCounts;

  return { [getEntryType(entry)]: 1 };
}

function readAssistantToolCallCounts(entry: Record<string, unknown>): Record<string, number> {
  if (entry.type !== "message") return {};

  const message = readRecord(entry.message);
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return {};

  const counts: Record<string, number> = {};
  for (const contentItem of message.content) {
    const item = readRecord(contentItem);
    if (item?.type !== "toolCall") continue;

    const toolName = typeof item.name === "string" && item.name.trim()
      ? item.name.trim()
      : "toolCall";
    const thinkingKey = getToolCallThinkingKey(toolName, item);
    counts[thinkingKey] = (counts[thinkingKey] || 0) + 1;
  }

  return counts;
}

function getToolCallThinkingKey(toolName: string, item: Record<string, unknown>): string {
  const skillName = readSkillNameFromToolCall(toolName, item);
  return skillName ? `/skill:${skillName}` : toolName;
}

function readSkillNameFromToolCall(
  toolName: string,
  item: Record<string, unknown>,
): string | undefined {
  if (toolName !== "read" && !toolName.endsWith(".read")) return undefined;

  const argumentsRecord = readToolCallArguments(item.arguments);
  const filePath = argumentsRecord?.path;
  if (typeof filePath !== "string") return undefined;

  const match = filePath.match(/(?:^|[/\\])([^/\\]+)[/\\]SKILL\.md$/);
  return match?.[1] || undefined;
}

function readToolCallArguments(value: unknown): Record<string, unknown> | undefined {
  const record = readRecord(value);
  if (record) return record;

  if (typeof value !== "string") return undefined;

  try {
    return readRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function getEntryType(entry: Record<string, unknown>): string {
  const entryType = typeof entry.type === "string" ? entry.type : "unknown";
  if (entryType !== "message") return entryType;

  const message = entry.message;
  if (!message || typeof message !== "object") return "message";

  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? `message.${role}` : "message";
}

function incrementThinkingCounts(
  counts: Record<string, number>,
  incrementCounts: Record<string, number>,
): void {
  for (const [entryType, count] of Object.entries(incrementCounts)) {
    counts[entryType] = (counts[entryType] || 0) + count;
  }
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

function formatThinkingCount(entryType: string, count: number): string {
  const formattedEntryType = formatThinkingEntryType(entryType);
  if (formattedEntryType.startsWith("/skill:") && count === 1) {
    return formattedEntryType;
  }

  return `${formattedEntryType}: ${count}`;
}

function createThinkingMessage(counts: Record<string, number>): SessionMessage | null {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  const text = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entryType, count]) => formatThinkingCount(entryType, count))
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
