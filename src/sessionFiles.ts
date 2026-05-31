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
}

export interface SessionDetail {
  title: string;
  filePath?: string;
  fileSize?: number;
  messages: SessionMessage[];
  error?: string;
}

export interface SessionFileSnapshot {
  filePath: string;
  createdAtMs: number;
}

export function getRecentSessions(): RecentSession[] {
  return getSessionFiles()
    .map(parseSessionFile)
    .filter((session): session is RecentSession => Boolean(session))
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
    return {
      title: path.basename(filePath),
      filePath,
      fileSize: Buffer.byteLength(content, "utf8"),
      messages: readSessionMessages(content),
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

  return createSessionFileWatcher(session.filePath, session.fileSize ?? 0, (messages) => {
    if (!messages.length) return;
    webview.postMessage({ command: "appendMessages", messages });
  });
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

export function readText(content: unknown): string {
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

function readSessionMessages(content: string): SessionMessage[] {
  return content
    .split(/\r\n|\r|\n/)
    .map(readSessionMessageLine)
    .filter((message): message is SessionMessage => Boolean(message));
}

function readSessionMessageLine(line: string): SessionMessage | null {
  if (!line.trim()) return null;

  try {
    const entry = JSON.parse(line);
    if (entry.type !== "message" || !entry.message) return null;

    const text = readText(entry.message.content);
    if (!text) return null;

    return {
      role: String(entry.message.role || "message"),
      text,
    };
  } catch {
    return null;
  }
}

function createSessionFileWatcher(
  filePath: string,
  startPosition: number,
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

      const messages = lines
        .map(readSessionMessageLine)
        .filter((message): message is SessionMessage => Boolean(message));
      onMessages(messages);
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
