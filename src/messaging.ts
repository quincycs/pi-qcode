import * as crypto from "node:crypto";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { isSessionFile } from "./sessionFiles";

interface MessageSession {
  guid: string;
  terminal: vscode.Terminal;
}

interface MsgMessage {
  type: "text";
  from: string;
  text: string;
}

export type MessageSessionMap = Map<string, MessageSession>;

export function sendSessionMessage(
  messageSessions: MessageSessionMap,
  filePath: string,
  text: string,
): void {
  if (!text) return;

  if (!isSessionFile(filePath)) {
    vscode.window.showErrorMessage("Unable to send message: invalid session file.");
    return;
  }

  const resolvedFilePath = path.resolve(filePath);
  const existingMessageSession = messageSessions.get(resolvedFilePath);
  if (existingMessageSession) {
    void sendSocketMessage(existingMessageSession.guid, {
      type: "text",
      from: "qcode",
      text,
    });
    return;
  }

  const guid = crypto.randomUUID();
  const terminal = createSessionTerminal();
  messageSessions.set(resolvedFilePath, { guid, terminal });

  terminal.show();
  terminal.sendText(buildSessionMessageCommand(resolvedFilePath, guid, text));
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
  const encodedMessage = message
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\n");

  return [
    "pi",
    "--session",
    shellEscape(sessionFilePath),
    shellEscape(`/msg-on ${guid}`),
    shellEscape(encodedMessage),
  ].join(" ");
}

function shellEscape(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
