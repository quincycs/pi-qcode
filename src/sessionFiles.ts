import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import {
  parseQcodeAttachmentBlock,
  type ChatAttachment,
} from "./chatAttachments";

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
  /** Skill commands expanded into this user message. */
  activatedSkills?: string[];
  attachments?: ChatAttachment[];
  timestamp?: number;
  /** Present only for qcode's local optimistic outbox. */
  clientMessageId?: string;
  deliveryState?: "pending" | "accepted" | "correlated" | "failed";
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

export interface SessionWarning {
  id: string;
  title: string;
  message: string;
}

interface SessionMessageState {
  lastRenderedWasUser: boolean;
  thinkingCounts: Record<string, number>;
  visibleMessages: SessionMessage[];
  hasSeenLifecycleEntry: boolean;
  compatibilityMode: boolean;
  activeLifecycleRun: boolean;
  currentLifecycleRunId?: string;
  pendingAssistantMessage?: SessionMessage;
  pendingCompatibilityAssistantMessage?: SessionMessage;
  contextUsage?: ContextUsage;
  modelId?: string;
  provider?: string;
  thinkingLevel?: string;
  sessionCost: number;
  sessionCostKnown: boolean;
}

export interface SessionDetail {
  title: string;
  filePath?: string;
  fileSize?: number;
  messages: SessionMessage[];
  contextUsage?: ContextUsage;
  warnings?: SessionWarning[];
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
      warnings: getSessionWarnings(messageState),
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
    (messages, contextUsage, warnings) => {
      webview.postMessage({
        command: "replaceMessages",
        messages,
        contextUsage,
        warnings,
      });
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

export function readActivatedSkillName(text: string): string | undefined {
  const trimmedText = parseQcodeAttachmentBlock(text).text.trim();
  const expandedMatch = trimmedText.endsWith("</skill>")
    ? trimmedText.match(/^<skill\s+name=(['"])([^'"]+)\1(?:\s|>)/)
    : undefined;
  if (expandedMatch?.[2]?.trim()) return expandedMatch[2].trim();

  // Treat whitespace and optional command arguments as presentation details.
  // Both forms identify the same authoritative skill-expanded user message.
  return trimmedText.match(/^\/skill:([^\s]+)(?:\s[\s\S]*)?$/)?.[1];
}

export function collapseSkillContent(text: string): string {
  const skillName = readActivatedSkillName(text);
  if (!skillName || !text.trim().startsWith("<skill")) return text;
  return `/skill:${skillName}`;
}

export function normalizeUserMessageText(text: string): string {
  const collapsed = collapseSkillContent(text);
  const skillName = readActivatedSkillName(collapsed);
  if (!skillName) return text;

  const trimmed = collapsed.trim();
  return trimmed === `/skill:${skillName}` ? trimmed : collapsed;
}

export function userMessageTextsMatch(left: string, right: string): boolean {
  const leftParsed = parseQcodeAttachmentBlock(left);
  const rightParsed = parseQcodeAttachmentBlock(right);
  const leftSkill = readActivatedSkillName(leftParsed.text);
  const rightSkill = readActivatedSkillName(rightParsed.text);
  const textMatches = leftSkill && rightSkill
    ? leftSkill === rightSkill
    : leftParsed.text === rightParsed.text;
  return textMatches && attachmentPathsMatch(
    leftParsed.attachments,
    rightParsed.attachments,
  );
}

export function countMatchingUserMessages(
  messages: SessionMessage[],
  text: string,
): number {
  return messages.reduce(
    (count, message) => count + (
      message.role === "user" && userMessageMatchesRawText(message, text) ? 1 : 0
    ),
    0,
  );
}

export function parseVisibleUserMessage(rawText: string): Pick<SessionMessage, "text" | "attachments"> {
  const parsed = parseQcodeAttachmentBlock(rawText);
  const text = normalizeUserMessageText(parsed.text);
  return {
    text,
    ...(parsed.attachments.length ? { attachments: parsed.attachments } : {}),
  };
}

export function userMessageMatchesRawText(message: SessionMessage, rawText: string): boolean {
  const raw = parseQcodeAttachmentBlock(rawText);
  const visibleTextMatches = userMessageTextsMatch(message.text, raw.text);
  return visibleTextMatches && attachmentPathsMatch(message.attachments ?? [], raw.attachments);
}

function attachmentPathsMatch(
  left: readonly ChatAttachment[],
  right: readonly ChatAttachment[],
): boolean {
  return left.length === right.length && left.every(
    (attachment, index) => attachment.path === right[index]?.path,
  );
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
    costTotal: readNonNegativeNumber(readRecord(usage.cost)?.total),
  };
}

function readPositiveNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
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
    const lines = selectActiveBranchLines(fs.readFileSync(filePath, "utf8"));

    let id = path.basename(filePath);
    let cwd = "";
    let model = "unknown";
    let messageCount = 0;
    let firstUserMessage = "";
    let latestUserMessage = "";
    let sessionName = "";
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

        if (entry.type === "model_change" && entry.modelId) {
          model = String(entry.modelId);
        }

        if (entry.type === "session_info") {
          sessionName = String(entry.name || "").trim();
        }

        if (entry.type === "message" && entry.message) {
          if (entry.message.role === "user") {
            const rawText = readText(entry.message.content);
            const parsed = parseQcodeAttachmentBlock(rawText);
            const text = collapseSkillContent(parsed.text);
            if ((text || parsed.attachments.length) && !text.startsWith("You are running inside VS Code")) {
              const previewText = text.trim() || `Attached: ${parsed.attachments.map((attachment) => attachment.name).join(", ")}`;
              const preview = previewText.slice(0, 160).replace(/\s+/g, " ").trim();
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
      title: sessionName || firstUserMessage || path.basename(filePath),
      preview: latestUserMessage || firstUserMessage || "(no messages yet)",
      createdAt,
      lastActiveAt,
    };
  } catch {
    return null;
  }
}

export function readSessionMessagesFromContent(content: string): {
  messages: SessionMessage[];
  warnings: SessionWarning[];
} {
  const state = readSessionMessageState(content, { skipContextUsage: true });
  return { messages: state.visibleMessages, warnings: getSessionWarnings(state) };
}

export function readSessionContextUsageFromContent(
  content: string,
): ContextUsage | undefined {
  return readSessionMessageState(content).contextUsage;
}

function readSessionMessageState(
  content: string,
  options: { skipContextUsage?: boolean } = {},
): SessionMessageState {
  const state = createEmptySessionMessageState();

  for (const line of selectActiveBranchLines(content)) {
    updateSessionMessageState(state, line, options);
  }
  finalizeSessionMessageState(state);

  return state;
}

/** Return the session header followed by only the append-selected active tree path. */
export function selectActiveBranchLines(content: string): string[] {
  const parsed: Array<{ line: string; entry: Record<string, unknown> }> = [];
  for (const line of content.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue;
    const entry = readSessionEntry(line);
    if (entry) parsed.push({ line, entry });
  }
  const header = parsed.find(({ entry }) => entry.type === "session");
  const treeEntries = parsed.filter(({ entry }) =>
    entry.type !== "session" && typeof entry.id === "string" && entry.id,
  );
  // Legacy v1 files have no tree IDs and remain linear.
  if (!treeEntries.length) return parsed.map(({ line }) => line);

  const byId = new Map<string, { line: string; entry: Record<string, unknown> }>();
  for (const item of treeEntries) byId.set(String(item.entry.id), item);
  let current: { line: string; entry: Record<string, unknown> } | undefined = treeEntries.at(-1);
  const reversePath: Array<{ line: string; entry: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  while (current) {
    const id = String(current.entry.id);
    if (seen.has(id)) break;
    seen.add(id);
    reversePath.push(current);
    const parentId = typeof current.entry.parentId === "string" ? current.entry.parentId : undefined;
    current = parentId ? byId.get(parentId) : undefined;
  }
  reversePath.reverse();
  return [...(header ? [header.line] : []), ...reversePath.map(({ line }) => line)];
}

function createEmptySessionMessageState(): SessionMessageState {
  return {
    lastRenderedWasUser: false,
    thinkingCounts: {},
    visibleMessages: [],
    hasSeenLifecycleEntry: false,
    compatibilityMode: false,
    activeLifecycleRun: false,
    currentLifecycleRunId: undefined,
    pendingAssistantMessage: undefined,
    pendingCompatibilityAssistantMessage: undefined,
    contextUsage: undefined,
    modelId: undefined,
    provider: undefined,
    thinkingLevel: undefined,
    sessionCost: 0,
    sessionCostKnown: false,
  };
}

function updateSessionMessageState(
  state: SessionMessageState,
  line: string,
  options: { skipContextUsage?: boolean } = {},
): boolean {
  const entry = readSessionEntry(line);
  if (!entry) return false;

  const contextChanged = options.skipContextUsage
    ? false
    : updateSessionContextUsage(state, entry);
  const lifecycleEntry = readPiLifecycleEntry(entry);
  if (lifecycleEntry) {
    const compatibilityChanged = !state.hasSeenLifecycleEntry
      ? finalizeCompatibilityAssistantMessage(state)
      : false;
    state.hasSeenLifecycleEntry = true;
    return updateSessionLifecycleState(state, lifecycleEntry) || compatibilityChanged || contextChanged;
  }

  if (!state.hasSeenLifecycleEntry) {
    return updateCompatibilitySessionMessageState(state, entry) || contextChanged;
  }

  if (state.activeLifecycleRun) {
    const pendingAssistantMessage = readRenderableSessionMessage(entry, {
      includeAssistant: true,
    });
    if (pendingAssistantMessage?.role === "assistant") {
      state.pendingAssistantMessage = pendingAssistantMessage;
      incrementThinkingCounts(state.thinkingCounts, readAssistantToolCallCounts(entry));
      upsertThinkingMessage(state.visibleMessages, state.thinkingCounts);
      return true;
    }
  }

  const message = readRenderableSessionMessage(entry);
  if (message) {
    appendVisibleSessionMessage(state, message);
    return true;
  }

  if (!state.lastRenderedWasUser) return contextChanged;

  incrementThinkingCounts(state.thinkingCounts, getThinkingEntryCounts(entry));
  upsertThinkingMessage(state.visibleMessages, state.thinkingCounts);
  return true;
}

function finalizeSessionMessageState(state: SessionMessageState): void {
  if (!state.hasSeenLifecycleEntry) {
    finalizeCompatibilityAssistantMessage(state);
  }
}

function updateCompatibilitySessionMessageState(
  state: SessionMessageState,
  entry: Record<string, unknown>,
): boolean {
  const message = readRenderableSessionMessage(entry, { includeAssistant: true });
  if (message) {
    state.compatibilityMode = true;

    if (message.role === "assistant") {
      state.pendingCompatibilityAssistantMessage = message;
      incrementThinkingCounts(state.thinkingCounts, readAssistantToolCallCounts(entry));
      upsertThinkingMessage(state.visibleMessages, state.thinkingCounts);
      return true;
    }

    finalizeCompatibilityAssistantMessage(state);
    appendVisibleSessionMessage(state, message);
    return true;
  }

  if (!state.lastRenderedWasUser) return false;

  incrementThinkingCounts(state.thinkingCounts, getThinkingEntryCounts(entry));
  upsertThinkingMessage(state.visibleMessages, state.thinkingCounts);
  return true;
}

function finalizeCompatibilityAssistantMessage(state: SessionMessageState): boolean {
  const pendingMessage = state.pendingCompatibilityAssistantMessage;
  if (!pendingMessage) return false;

  appendVisibleSessionMessage(state, pendingMessage);
  state.pendingCompatibilityAssistantMessage = undefined;
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
      if (usage?.costTotal !== undefined) {
        state.sessionCost += usage.costTotal;
        state.sessionCostKnown = true;
      }
      if (usedTokens > 0 || usage?.costTotal !== undefined) {
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
    !state.sessionCostKnown
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
    sessionCost: state.sessionCostKnown ? state.sessionCost : undefined,
  };
}

function serializeContextUsage(usage: ContextUsage | undefined): string {
  return JSON.stringify(usage ?? null);
}

function getSessionWarnings(state: SessionMessageState): SessionWarning[] {
  const warnings: SessionWarning[] = [];

  if (state.compatibilityMode) {
    warnings.push({
      id: "compatibility-mode",
      title: "Compatibility mode",
      message: "This inactive legacy session is reconstructed best-effort from its saved JSONL entries. Resume it from qcode to use the bundled live bridge.",
    });
  }

  return warnings;
}

function appendVisibleSessionMessage(
  state: SessionMessageState,
  message: SessionMessage,
): void {
  removeThinkingMessage(state.visibleMessages);
  state.visibleMessages.push(message);
  state.lastRenderedWasUser = message.role === "user";
  state.thinkingCounts = {};
  for (const skillName of message.activatedSkills ?? []) {
    state.thinkingCounts[getSkillThinkingKey(skillName)] = 1;
  }
  state.pendingAssistantMessage = undefined;
  state.pendingCompatibilityAssistantMessage = undefined;
  if (state.lastRenderedWasUser) {
    upsertThinkingMessage(state.visibleMessages, state.thinkingCounts);
  }
}

interface PiLifecycleEntry {
  event: string;
  state?: string;
  runId?: string;
}

function readPiLifecycleEntry(entry: Record<string, unknown>): PiLifecycleEntry | undefined {
  if (entry.type !== "custom" || entry.customType !== "pi-lifecycle") return undefined;

  const data = readRecord(entry.data);
  const event = typeof data?.event === "string"
    ? data.event
    : typeof entry.event === "string"
      ? entry.event
      : undefined;
  if (!event) return undefined;

  const state = typeof data?.state === "string"
    ? data.state
    : typeof entry.state === "string"
      ? entry.state
      : undefined;
  const runId = typeof data?.runId === "string"
    ? data.runId
    : typeof entry.runId === "string"
      ? entry.runId
      : undefined;

  return { event, state, runId };
}

function updateSessionLifecycleState(
  state: SessionMessageState,
  lifecycleEntry: PiLifecycleEntry,
): boolean {
  if (lifecycleEntry.event === "session_start") {
    // Multiple installed lifecycle writers produce the same idle transition.
    // Never let a late duplicate reset a run that has already become busy.
    if (state.activeLifecycleRun) return false;
    state.currentLifecycleRunId = undefined;
    state.pendingAssistantMessage = undefined;
    return false;
  }

  if (lifecycleEntry.event === "agent_start") {
    if (state.activeLifecycleRun) return false;
    state.activeLifecycleRun = true;
    state.currentLifecycleRunId = lifecycleEntry.runId;
    state.pendingAssistantMessage = undefined;
    return false;
  }

  if (
    lifecycleEntry.event === "agent_end" ||
    (lifecycleEntry.event === "session_shutdown" && lifecycleEntry.state === "idle")
  ) {
    if (!state.activeLifecycleRun) return false;
    if (
      lifecycleEntry.runId && state.currentLifecycleRunId &&
      lifecycleEntry.runId !== state.currentLifecycleRunId
    ) return false;
    state.activeLifecycleRun = false;
    state.currentLifecycleRunId = undefined;
    return finalizePendingAssistantMessage(state);
  }

  return false;
}

function finalizePendingAssistantMessage(state: SessionMessageState): boolean {
  if (state.pendingAssistantMessage) {
    appendVisibleSessionMessage(state, state.pendingAssistantMessage);
    return true;
  }

  const hadThinkingMessage = state.visibleMessages.at(-1)?.kind === "thinking";
  removeThinkingMessage(state.visibleMessages);
  state.lastRenderedWasUser = false;
  state.thinkingCounts = {};
  return Boolean(hadThinkingMessage);
}

function readRenderableSessionMessage(
  entry: Record<string, unknown>,
  options: { includeAssistant?: boolean } = {},
): SessionMessage | null {
  const messageEntry = entry.message;
  if (entry.type !== "message" || !messageEntry || typeof messageEntry !== "object") return null;

  const message = messageEntry as Record<string, unknown>;
  const role = String(message.role || "message");
  if (role !== "user" && !(options.includeAssistant && role === "assistant")) return null;

  const errorMessage = role === "assistant" ? readAssistantErrorMessage(message, entry) : "";
  const rawText = errorMessage || readText(message.content);
  const visibleUserMessage = role === "user" ? parseVisibleUserMessage(rawText) : undefined;
  const text = visibleUserMessage?.text ?? rawText;
  if (!text && !visibleUserMessage?.attachments?.length) return null;

  const activatedSkills = role === "user"
    ? readActivatedSkillNames(message.content)
    : [];
  return {
    role,
    text,
    kind: "message",
    ...(visibleUserMessage?.attachments?.length ? { attachments: visibleUserMessage.attachments } : {}),
    ...(activatedSkills.length ? { activatedSkills } : {}),
    timestamp: readMessageTimestamp(message.timestamp, entry.timestamp),
  };
}

function readMessageTimestamp(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !value.trim()) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
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
  return getToolThinkingKey(toolName, item.arguments, typeof item.skillName === "string"
    ? item.skillName
    : undefined);
}

export function getToolThinkingKey(
  toolName: string,
  args: unknown,
  reportedSkillName?: string,
): string {
  const skillName = reportedSkillName?.trim() || readSkillNameFromToolCall(toolName, args);
  return skillName ? getSkillThinkingKey(skillName) : toolName;
}

function readSkillNameFromToolCall(
  toolName: string,
  args: unknown,
): string | undefined {
  if (toolName !== "read" && !toolName.endsWith(".read")) return undefined;

  const filePath = readToolCallArguments(args)?.path;
  if (typeof filePath !== "string") return undefined;

  const match = filePath.match(/(?:^|[/\\])([^/\\]+)[/\\]SKILL\.md$/);
  return match?.[1] || undefined;
}

function getSkillThinkingKey(skillName: string): string {
  return `/skill:${skillName}`;
}

function readActivatedSkillNames(content: unknown): string[] {
  const textItems = typeof content === "string"
    ? [content]
    : Array.isArray(content)
      ? content
          .map((item) => readRecord(item))
          .filter((item): item is Record<string, unknown> =>
            Boolean(item?.type === "text" && typeof item.text === "string"))
          .map((item) => String(item.text))
      : [];
  return [...new Set(textItems.map(readActivatedSkillName).filter(
    (name): name is string => Boolean(name),
  ))];
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
    counts[entryType] = entryType.startsWith("/skill:")
      ? Math.max(counts[entryType] || 0, count)
      : (counts[entryType] || 0) + count;
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
  if (formattedEntryType.startsWith("/skill:")) return formattedEntryType;

  return `${formattedEntryType}: ${count}`;
}

export function createThinkingMessage(counts: Record<string, number>): SessionMessage | null {
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
  _startPosition: number,
  messageState: SessionMessageState,
  onMessages: (
    messages: SessionMessage[],
    contextUsage?: ContextUsage,
    warnings?: SessionWarning[],
  ) => void,
): vscode.Disposable | undefined {
  let disposed = false;

  const readAppendedLines = () => {
    if (disposed) return;

    try {
      // Rebuild from the complete file. A newly appended entry can select an older
      // parent, so incremental append parsing cannot correctly follow /tree branches.
      const content = fs.readFileSync(filePath, "utf8");
      const rebuiltState = readSessionMessageState(content);
      Object.assign(messageState, rebuiltState);
      onMessages(
        messageState.visibleMessages,
        messageState.contextUsage,
        getSessionWarnings(messageState),
      );
    } catch {
      // Ignore transient reads while the session file is being replaced/appended.
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
    // Watch the directory so an atomic replacement does not detach the watcher
    // from the old inode. Both change and rename events can carry new contents.
    watcher = fs.watch(path.dirname(filePath), { persistent: false }, (_eventType, fileName) => {
      if (!fileName || fileName.toString() === path.basename(filePath)) scheduleRead();
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
