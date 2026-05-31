import * as vscode from "vscode";
import { sendSessionMessage, type MessageSessionMap } from "./messaging";
import type { SessionDetail } from "./sessionFiles";
import { readSessionDetail, watchSessionDetail } from "./sessionFiles";
import { getNonce } from "./utils";
import { renderHome } from "./webviews/home";
import { renderSessionDetail } from "./webviews/sessionDetail";

const viewType = "qcode.home";

type Route = { name: "home" } | { name: "sessionDetail"; filePath?: string };

type WebviewMessage =
  | { command: "openSession"; filePath?: string }
  | { command: "newSession" }
  | { command: "home" }
  | { command: "sendMessage"; filePath?: string; text?: string };

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(viewType, {
      resolveWebviewView(view) {
        let currentRoute: Route = { name: "home" };
        let sessionWatcher: vscode.Disposable | undefined;
        const messageSessions: MessageSessionMap = new Map();

        view.webview.options = { enableScripts: true };

        const stopSessionWatcher = () => {
          if (!sessionWatcher) return;
          sessionWatcher.dispose();
          sessionWatcher = undefined;
        };

        const showHome = () => {
          stopSessionWatcher();
          currentRoute = { name: "home" };
          view.webview.html = renderHome(getNonce());
        };

        const showSessionDetail = (filePath: string) => {
          stopSessionWatcher();
          const session = readSessionDetail(filePath);
          currentRoute = { name: "sessionDetail", filePath };
          view.webview.html = renderSessionDetail(filePath, getNonce(), session);
          sessionWatcher = watchSessionDetail(session, view.webview);
        };

        const showNewSessionDetail = () => {
          stopSessionWatcher();
          const session: SessionDetail = { title: "New Session", messages: [] };
          currentRoute = { name: "sessionDetail" };
          view.webview.html = renderSessionDetail("", getNonce(), session, { autoFocus: true });
        };

        const attachSessionFileToCurrentDetail = (filePath: string) => {
          if (currentRoute.name !== "sessionDetail" || currentRoute.filePath) return;

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

        showHome();

        view.webview.onDidReceiveMessage((message: WebviewMessage) => {
          if (!message || typeof message.command !== "string") return;

          if (message.command === "openSession") {
            showSessionDetail(String(message.filePath || ""));
          }

          if (message.command === "newSession") {
            showNewSessionDetail();
          }

          if (message.command === "home") {
            showHome();
          }

          if (message.command === "sendMessage") {
            void handleSendMessage(message);
          }
        });

        view.onDidChangeVisibility(() => {
          if (!view.visible) return;

          if (currentRoute.name === "sessionDetail") {
            if (currentRoute.filePath) showSessionDetail(currentRoute.filePath);
            else showNewSessionDetail();
          } else {
            showHome();
          }
        });

        context.subscriptions.push({ dispose: stopSessionWatcher });
      },
    }),
  );
}

export function deactivate(): void {}
