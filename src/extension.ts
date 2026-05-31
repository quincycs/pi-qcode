import * as path from "node:path";
import * as vscode from "vscode";
import { searchFileSuggestions } from "./fileSuggestions";
import { searchHashAutocompleteSuggestions } from "./hashAutocomplete";
import { sendSessionMessage, type MessageSessionMap } from "./messaging";
import {
  getSettingsFilePath,
  readQcodeSettings,
  writeQcodeSettings,
} from "./qcodeSettings";
import type { SessionDetail } from "./sessionFiles";
import { readSessionDetail, watchSessionDetail } from "./sessionFiles";
import { getNonce } from "./utils";
import { renderHome } from "./webviews/home";
import { renderSessionDetail } from "./webviews/sessionDetail";
import { renderSettings } from "./webviews/settings";

const viewType = "qcode.home";

type Route =
  | { name: "home" }
  | { name: "sessionDetail"; filePath?: string }
  | { name: "settings" };

type WebviewMessage =
  | { command: "openSession"; filePath?: string }
  | { command: "newSession" }
  | { command: "ready" }
  | { command: "home" }
  | { command: "settings" }
  | { command: "saveSettings"; settings?: unknown }
  | { command: "sendMessage"; filePath?: string; text?: string }
  | { command: "searchFiles"; requestId?: number; query?: string }
  | { command: "searchHashOptions"; requestId?: number; query?: string };

export function activate(context: vscode.ExtensionContext): void {
  let addToActiveQcodeInput: (() => void) | undefined;
  let pendingInputText = "";

  const queueInputText = (text: string) => {
    pendingInputText = pendingInputText ? `${pendingInputText}\n${text}` : text;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("qcode.addToQcode", async () => {
      const selectedText = getSelectedEditorText();
      if (!selectedText) return;

      queueInputText(selectedText);

      if (!addToActiveQcodeInput) {
        await vscode.commands.executeCommand("qcode.home.focus");
      }

      if (!addToActiveQcodeInput) {
        vscode.window.showInformationMessage(
          "Open QCode to add selected text to its input.",
        );
        return;
      }

      addToActiveQcodeInput();
    }),
    vscode.window.registerWebviewViewProvider(viewType, {
      resolveWebviewView(view) {
        let currentRoute: Route = { name: "home" };
        let sessionWatcher: vscode.Disposable | undefined;
        let detailWebviewReady = false;
        const messageSessions: MessageSessionMap = new Map();

        view.webview.options = { enableScripts: true };

        const stopSessionWatcher = () => {
          if (!sessionWatcher) return;
          sessionWatcher.dispose();
          sessionWatcher = undefined;
        };

        const showHome = () => {
          stopSessionWatcher();
          detailWebviewReady = false;
          currentRoute = { name: "home" };
          view.webview.html = renderHome(getNonce(), getWorkspaceCwd());
        };

        const showSettings = () => {
          stopSessionWatcher();
          detailWebviewReady = false;
          currentRoute = { name: "settings" };
          view.webview.html = renderSettings(
            getNonce(),
            readQcodeSettings(),
            getSettingsFilePath(),
          );
        };

        const showSessionDetail = (filePath: string) => {
          stopSessionWatcher();
          detailWebviewReady = false;
          const session = readSessionDetail(filePath);
          currentRoute = { name: "sessionDetail", filePath };
          view.webview.html = renderSessionDetail(
            filePath,
            getNonce(),
            session,
          );
          sessionWatcher = watchSessionDetail(session, view.webview);
        };

        const showNewSessionDetail = () => {
          stopSessionWatcher();
          detailWebviewReady = false;
          const session: SessionDetail = { title: "New Session", messages: [] };
          currentRoute = { name: "sessionDetail" };
          view.webview.html = renderSessionDetail("", getNonce(), session, {
            autoFocus: true,
          });
        };

        const attachSessionFileToCurrentDetail = (filePath: string) => {
          if (currentRoute.name !== "sessionDetail" || currentRoute.filePath)
            return;

          const session = readSessionDetail(filePath);
          currentRoute = { name: "sessionDetail", filePath };
          sessionWatcher = watchSessionDetail(session, view.webview);
          view.webview.postMessage({
            command: "sessionFileReady",
            filePath,
            title: session.title,
            messages: session.messages,
          });
        };

        const handleSendMessage = async (
          message: Extract<WebviewMessage, { command: "sendMessage" }>,
        ) => {
          const result = await sendSessionMessage(
            messageSessions,
            String(message.filePath || ""),
            String(message.text || ""),
          );

          if (result.sessionFilePath) {
            attachSessionFileToCurrentDetail(result.sessionFilePath);
          }
        };

        const handleSearchFiles = async (
          message: Extract<WebviewMessage, { command: "searchFiles" }>,
        ) => {
          const requestId = Number(message.requestId || 0);
          const items = await searchFileSuggestions(String(message.query || ""));
          await view.webview.postMessage({
            command: "fileSuggestions",
            requestId,
            items,
          });
        };

        const handleSearchHashOptions = async (
          message: Extract<WebviewMessage, { command: "searchHashOptions" }>,
        ) => {
          const requestId = Number(message.requestId || 0);
          const items = searchHashAutocompleteSuggestions(
            String(message.query || ""),
          );
          await view.webview.postMessage({
            command: "hashSuggestions",
            requestId,
            items,
          });
        };

        const handleSaveSettings = async (
          message: Extract<WebviewMessage, { command: "saveSettings" }>,
        ) => {
          try {
            const settings = await writeQcodeSettings(message.settings);
            await view.webview.postMessage({ command: "settingsSaved", settings });
          } catch (error) {
            await view.webview.postMessage({
              command: "settingsSaveError",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };

        const deliverPendingInput = () => {
          if (
            !pendingInputText ||
            !detailWebviewReady ||
            currentRoute.name !== "sessionDetail"
          ) {
            return;
          }

          const text = pendingInputText;
          view.webview.postMessage({ command: "addToInput", text }).then((sent) => {
            if (sent && pendingInputText === text) pendingInputText = "";
          });
        };

        addToActiveQcodeInput = () => {
          view.show?.(true);
          if (currentRoute.name !== "sessionDetail") {
            showNewSessionDetail();
          }

          deliverPendingInput();
        };

        showHome();

        view.webview.onDidReceiveMessage((message: WebviewMessage) => {
          if (!message || typeof message.command !== "string") return;

          if (message.command === "ready") {
            detailWebviewReady = true;
            deliverPendingInput();
          }

          if (message.command === "openSession") {
            showSessionDetail(String(message.filePath || ""));
          }

          if (message.command === "newSession") {
            showNewSessionDetail();
          }

          if (message.command === "home") {
            showHome();
          }

          if (message.command === "settings") {
            showSettings();
          }

          if (message.command === "sendMessage") {
            void handleSendMessage(message);
          }

          if (message.command === "searchFiles") {
            void handleSearchFiles(message);
          }

          if (message.command === "searchHashOptions") {
            void handleSearchHashOptions(message);
          }

          if (message.command === "saveSettings") {
            void handleSaveSettings(message);
          }
        });

        view.onDidChangeVisibility(() => {
          if (!view.visible) return;

          if (currentRoute.name === "sessionDetail") {
            if (currentRoute.filePath) showSessionDetail(currentRoute.filePath);
          } else if (currentRoute.name === "settings") {
            showSettings();
          } else {
            showHome();
          }
        });

        context.subscriptions.push({
          dispose() {
            stopSessionWatcher();
            addToActiveQcodeInput = undefined;
          },
        });
      },
    }),
  );
}

function getSelectedEditorText(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";

  const selectedText = editor.selections
    .map((selection) => editor.document.getText(selection))
    .filter(Boolean)
    .join("\n");
  if (!selectedText) return "";

  return `@${getRelativeEditorPath(editor)}\n\`\`\`\n${selectedText}\n\`\`\``;
}

function getRelativeEditorPath(editor: vscode.TextEditor): string {
  if (editor.document.uri.scheme !== "file") {
    return vscode.workspace.asRelativePath(editor.document.uri, false);
  }

  const filePath = path.resolve(editor.document.uri.fsPath);
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const workspaceFolder = workspaceFolders
    .map((folder) => path.resolve(folder.uri.fsPath))
    .sort((a, b) => b.length - a.length)
    .find((folderPath) => isPathInside(filePath, folderPath));

  if (!workspaceFolder) return editor.document.uri.fsPath;

  return path.relative(workspaceFolder, filePath).split(path.sep).join("/");
}

function isPathInside(filePath: string, folderPath: string): boolean {
  const relativePath = path.relative(folderPath, filePath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function getWorkspaceCwd(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  return workspaceFolder ? workspaceFolder.uri.fsPath : undefined;
}

export function deactivate(): void {}
