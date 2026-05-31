import * as vscode from "vscode";
import { sendSessionMessage, type MessageSessionMap } from "./messaging";
import { readSessionDetail, watchSessionDetail } from "./sessionFiles";
import { getNonce } from "./utils";
import { renderHome } from "./webviews/home";
import { renderSessionDetail } from "./webviews/sessionDetail";

const viewType = "qcode.home";

type Route = { name: "home" } | { name: "sessionDetail"; filePath: string };

type WebviewMessage =
  | { command: "openSession"; filePath?: string }
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

        showHome();

        view.webview.onDidReceiveMessage((message: WebviewMessage) => {
          if (!message || typeof message.command !== "string") return;

          if (message.command === "openSession") {
            showSessionDetail(String(message.filePath || ""));
          }

          if (message.command === "home") {
            showHome();
          }

          if (message.command === "sendMessage") {
            sendSessionMessage(
              messageSessions,
              String(message.filePath || ""),
              String(message.text || ""),
            );
          }
        });

        view.onDidChangeVisibility(() => {
          if (!view.visible) return;

          if (currentRoute.name === "sessionDetail") {
            showSessionDetail(currentRoute.filePath);
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
