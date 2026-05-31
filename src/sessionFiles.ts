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

interface SessionMessageState {
  lastRenderedWasUser: boolean;
  thinkingCounts: Record<string, number>;
  visibleMessages: SessionMessage[];
}

export interface SessionDetail {
  title: string;
  filePath?: string;
  fileSize?: number;
  messages: SessionMessage[];
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
    (messages) => {
      webview.postMessage({ command: "replaceMessages", messages });
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

function readText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
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
          if (entry.message.role === "user" && !firstUserMessage) {
            const text = readText(entry.message.content);
            if (text && !text.startsWith("You are running inside VS Code")) {
              firstUserMessage = text.slice(0, 160).replace(/\s+/g, " ").trim();
            }
          }

          if (entry.message.role === "assistant") {
            messageCount += 1;
            if (entry.usage && Number(entry.usage.totalTokens)) {
              totalTokens += Number(entry.usage.totalTokens);
            }
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
      preview: firstUserMessage || "(no messages yet)",
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
  };
}

function updateSessionMessageState(state: SessionMessageState, line: string): boolean {
  const entry = readSessionEntry(line);
  if (!entry) return false;

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

  if (!state.lastRenderedWasUser) return false;

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

function createSessionFileWatcher(
  filePath: string,
  startPosition: number,
  messageState: SessionMessageState,
  onMessages: (messages: SessionMessage[]) => void,
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
      if (changed) onMessages(messageState.visibleMessages);
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
