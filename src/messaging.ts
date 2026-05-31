import * as crypto from "node:crypto";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  getNewestSessionFileForCwd,
  isSessionFile,
  type SessionFileSnapshot,
} from "./sessionFiles";

interface MessageSession {
  guid: string;
  terminal: vscode.Terminal;
}

interface MsgMessage {
  type: "text";
  from: string;
  text: string;
  asUser?: boolean;
}

export type MessageSessionMap = Map<string, MessageSession>;

export interface SendSessionMessageResult {
  sessionFilePath?: string;
}

export async function sendSessionMessage(
  messageSessions: MessageSessionMap,
  filePath: string,
  text: string,
): Promise<SendSessionMessageResult> {
  if (!text) return {};

  if (!filePath) {
    return startNewSessionMessage(messageSessions, text);
  }

  if (!isSessionFile(filePath)) {
    vscode.window.showErrorMessage("Unable to send message: invalid session file.");
    return {};
  }

  const resolvedFilePath = path.resolve(filePath);
  const existingMessageSession = messageSessions.get(resolvedFilePath);
  if (existingMessageSession) {
    void sendSocketMessage(existingMessageSession.guid, {
      type: "text",
      from: "qcode",
      text,
      asUser: true,
    });
    return {};
  }

  const guid = crypto.randomUUID();
  const terminal = createSessionTerminal();
  messageSessions.set(resolvedFilePath, { guid, terminal });

  terminal.show();
  terminal.sendText(buildSessionMessageCommand(resolvedFilePath, guid, text));
  return {};
}

async function startNewSessionMessage(
  messageSessions: MessageSessionMap,
  text: string,
): Promise<SendSessionMessageResult> {
  const cwd = getWorkspaceCwd();
  if (!cwd) {
    vscode.window.showErrorMessage("Unable to start session: no workspace folder is open.");
    return {};
  }

  const before = getNewestSessionFileForCwd(cwd);
  const guid = crypto.randomUUID();
  const terminal = createSessionTerminal();

  terminal.show();
  terminal.sendText(buildNewSessionMessageCommand(guid, text));

  const sessionFilePath = await waitForNewSessionFile(cwd, before);
  if (!sessionFilePath) {
    vscode.window.showErrorMessage("Unable to find the new Pi session file.");
    return {};
  }

  messageSessions.set(path.resolve(sessionFilePath), { guid, terminal });
  return { sessionFilePath };
}

async function waitForNewSessionFile(
  cwd: string,
  before: SessionFileSnapshot | undefined,
): Promise<string | undefined> {
  const deadline = Date.now() + 3000;

  while (Date.now() <= deadline) {
    const newest = getNewestSessionFileForCwd(cwd);
    if (newest && (!before || newest.filePath !== before.filePath)) {
      return newest.filePath;
    }

    await delay(200);
  }

  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendSocketMessage(target: string, message: MsgMessage): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.createConnection(getMsgSocketPath(target));
    let reply = "";

    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(reply);
    });

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
      socket.end();
    });

    socket.on("data", (chunk) => {
      reply += chunk.toString();
    });

    socket.on("end", () => resolve(reply));
    socket.on("error", () => resolve(""));
  });
}

function getMsgSocketPath(name: string): string {
  return path.join(os.homedir(), ".pi", "msg", `${name}.sock`);
}

function createSessionTerminal(): vscode.Terminal {
  const cwd = getWorkspaceCwd();
  return vscode.window.createTerminal({
    name: "QCode Session Message",
    ...(cwd ? { cwd } : {}),
  });
}

function getWorkspaceCwd(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  return workspaceFolder ? workspaceFolder.uri.fsPath : undefined;
}

function buildSessionMessageCommand(sessionFilePath: string, guid: string, message: string): string {
  return [
    "pi",
    "--session",
    shellEscape(sessionFilePath),
    shellEscape(`/msg-on ${guid}`),
    shellEscape(encodeMessageArgument(message)),
  ].join(" ");
}

function buildNewSessionMessageCommand(guid: string, message: string): string {
  return ["pi", shellEscape(`/msg-on ${guid}`), shellEscape(encodeMessageArgument(message))].join(
    " ",
  );
}

function encodeMessageArgument(message: string): string {
  return message.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\\n");
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
