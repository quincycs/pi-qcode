import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  normalizeSessionDraft,
  removePastedAttachment,
  savePastedAttachment,
  serializeQcodeAttachmentPrompt,
  validateChatAttachment,
  validateChatAttachmentList,
  type SessionDraft,
} from "./chatAttachments";
import { searchFileSuggestions } from "./fileSuggestions";
import {
  fileReferenceExists,
  openExternalUrl,
  openFileReference,
} from "./fileReferences";
import { searchHashAutocompleteSuggestions } from "./hashAutocomplete";
import { PI_BRIDGE_MAX_MESSAGE_BYTES } from "./piBridgeProtocol";
import { playNotificationSoundFile } from "./notificationSound";
import { PiTerminalSessions, type PiTerminalSessionView } from "./piTerminalSessions";
import {
  dismissWhatsNewVersion,
  getSettingsFilePath,
  readQcodeSettings,
  type QcodeSettings,
  writeQcodeSettings,
} from "./qcodeSettings";
import type { SessionDetail, SessionWarning } from "./sessionFiles";
import {
  getSessionFolderForCwd,
  isSessionFile,
  readSessionDetail,
  watchSessionDetail,
} from "./sessionFiles";
import {
  readSessionPins,
  sessionPinKey,
  setSessionPinned,
} from "./sessionPins";
import { delay, getNonce } from "./utils";
import { renderHome } from "./webviews/home";
import { renderSessionDetail } from "./webviews/sessionDetail";
import { renderSettings } from "./webviews/settings";
import { getWhatsNewRelease } from "./whatsNew";

const viewType = "pi-qcode.home";
const sessionDraftsStorageKey = "sessionDrafts";
const newSessionDraftKey = "new-session";

type Route =
  | { name: "home" }
  | { name: "sessionDetail"; filePath?: string; bridgeId?: string }
  | { name: "settings" };

type WebviewMessage =
  | { command: "openSession"; filePath?: string }
  | { command: "setSessionPinned"; filePath?: string; pinned?: boolean }
  | { command: "newSession" }
  | { command: "dismissWhatsNew"; version?: string }
  | { command: "ready" }
  | { command: "home"; filePath?: string; draftText?: string; draftAttachments?: unknown }
  | { command: "settings" }
  | { command: "saveSettings"; settings?: unknown }
  | { command: "confirmDeleteHashOption"; index?: number; label?: string }
  | { command: "confirmDeleteProviderOption"; index?: number; label?: string }
  | { command: "saveLastUsedProvider"; nickname?: string }
  | { command: "showSessionWarnings"; warnings?: unknown }
  | { command: "playNotificationSound" }
  | { command: "sendMessage"; filePath?: string; text?: string; attachments?: unknown; providerCliArgs?: string; clientMessageId?: string }
  | { command: "savePastedAttachment"; requestId?: string; name?: unknown; mimeType?: unknown; size?: unknown; data?: unknown }
  | { command: "removePastedAttachment"; attachment?: unknown }
  | { command: "copyToClipboard"; text?: string }
  | { command: "openFileReference"; value?: string }
  | { command: "openExternalUrl"; value?: string }
  | { command: "resolveFileReferences"; requestId?: number; values?: unknown }
  | { command: "searchFiles"; requestId?: number; query?: string }
  | { command: "searchHashOptions"; requestId?: number; query?: string };

export function activate(context: vscode.ExtensionContext): void {
  const terminalSessions = new PiTerminalSessions(context);
  const extensionVersion = String(context.extension.packageJSON.version || "");
  let addToActiveQcodeInput: (() => void) | undefined;
  let pendingInputText = "";
  const sessionDrafts = readStoredSessionDrafts(
    context.workspaceState.get<unknown>(sessionDraftsStorageKey),
  );
  let draftPersistence = Promise.resolve();
  const getSessionDraftKey = (filePath: string): string => {
    if (!filePath) return newSessionDraftKey;

    const resolvedPath = path.resolve(filePath);
    return `session:${process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath}`;
  };
  const getSessionDraft = (filePath: string): SessionDraft => {
    return sessionDrafts.get(getSessionDraftKey(filePath)) ?? { text: "", attachments: [] };
  };
  const saveSessionDraft = (filePath: string, draft: SessionDraft): void => {
    const key = getSessionDraftKey(filePath);
    if (draft.text || draft.attachments.length) sessionDrafts.set(key, draft);
    else sessionDrafts.delete(key);

    const snapshot = Object.fromEntries(sessionDrafts);
    draftPersistence = draftPersistence
      .then(() => context.workspaceState.update(sessionDraftsStorageKey, snapshot))
      .catch((error) => {
        console.error("Unable to save session draft:", error);
      });
  };
  const extensionMediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
  const defaultAssistantSoundUri = vscode.Uri.joinPath(extensionMediaRoot, "chime.wav");
  const mermaidScriptUri = vscode.Uri.joinPath(
    extensionMediaRoot,
    "vendor",
    "mermaid.min.js",
  );
  const defaultAssistantSoundPath = defaultAssistantSoundUri.fsPath;

  const resolveAssistantSoundPath = (settings: QcodeSettings): string => {
    const configuredPath = settings.assistantSoundPath.trim();
    if (!configuredPath) return defaultAssistantSoundPath;

    const expandedPath = configuredPath.startsWith("~/") || configuredPath.startsWith("~\\")
      ? path.join(os.homedir(), configuredPath.slice(2))
      : configuredPath === "~"
        ? os.homedir()
        : configuredPath;

    if (path.isAbsolute(expandedPath)) return expandedPath;

    return path.resolve(getWorkspaceCwd() ?? os.homedir(), expandedPath);
  };

  const playConfiguredNotificationSound = async (
    webview: vscode.Webview,
  ): Promise<void> => {
    const settings = readQcodeSettings();
    if (!settings.assistantSoundEnabled) return;

    const playedNatively = !vscode.env.remoteName &&
      await playNotificationSoundFile(resolveAssistantSoundPath(settings));
    if (!playedNatively) {
      await webview.postMessage({ command: "playNotificationSoundFallback" });
    }
  };

  const queueInputText = (text: string) => {
    pendingInputText = pendingInputText ? `${pendingInputText}\n${text}` : text;
  };

  const addTextToQcodeInput = async (text: string) => {
    if (!text) return;

    queueInputText(text);

    if (!addToActiveQcodeInput) {
      await vscode.commands.executeCommand("pi-qcode.home.focus");
    }

    if (!addToActiveQcodeInput) {
      vscode.window.showInformationMessage(
        "Open pi-qcode to add selected text to its input.",
      );
      return;
    }

    addToActiveQcodeInput();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("pi-qcode.addToQcode", async () => {
      await addTextToQcodeInput(getSelectedEditorText());
    }),
    vscode.commands.registerCommand(
      "pi-qcode.addTerminalSelectionToQcode",
      async () => {
        await addTextToQcodeInput(await getSelectedTerminalText());
      },
    ),
    vscode.window.registerWebviewViewProvider(viewType, {
      resolveWebviewView(view) {
        let currentRoute: Route = { name: "home" };
        let sessionWatcher: vscode.Disposable | undefined;
        let detailWebviewReady = false;
        const shownBridgeActionErrors = new Set<string>();
        const dismissedWhatsNewVersions = new Set(
          readQcodeSettings().dismissedWhatsNewVersions,
        );
        const configureWebviewOptions = (settings: QcodeSettings = readQcodeSettings()) => {
          const soundPath = resolveAssistantSoundPath(settings);
          const localResourceRoots = [extensionMediaRoot];
          if (soundPath !== defaultAssistantSoundPath) {
            localResourceRoots.push(vscode.Uri.file(path.dirname(soundPath)));
          }

          view.webview.options = { enableScripts: true, localResourceRoots };
        };
        const getAssistantSoundWebviewUri = (settings: QcodeSettings): string => {
          return view.webview.asWebviewUri(
            vscode.Uri.file(resolveAssistantSoundPath(settings)),
          ).toString();
        };
        const getMermaidScriptWebviewUri = (): string => {
          return view.webview.asWebviewUri(mermaidScriptUri).toString();
        };

        configureWebviewOptions();

        const stopSessionWatcher = () => {
          if (!sessionWatcher) return;
          sessionWatcher.dispose();
          sessionWatcher = undefined;
        };

        const showHome = () => {
          stopSessionWatcher();
          detailWebviewReady = false;
          configureWebviewOptions();
          currentRoute = { name: "home" };
          const whatsNew = dismissedWhatsNewVersions.has(extensionVersion)
            ? undefined
            : getWhatsNewRelease(extensionVersion);
          const workspaceCwd = getWorkspaceCwd();
          view.webview.html = renderHome(
            getNonce(),
            workspaceCwd,
            extensionVersion,
            whatsNew,
            workspaceCwd ? readSessionPins(workspaceCwd) : new Map(),
          );
        };

        const showSettings = () => {
          stopSessionWatcher();
          detailWebviewReady = false;
          const settings = readQcodeSettings();
          configureWebviewOptions(settings);
          currentRoute = { name: "settings" };
          view.webview.html = renderSettings(
            getNonce(),
            settings,
            getSettingsFilePath(),
            defaultAssistantSoundPath,
            getWhatsNewRelease(extensionVersion),
          );
        };

        const showSessionDetail = (filePath: string) => {
          stopSessionWatcher();
          detailWebviewReady = false;
          const bridgeSession = terminalSessions.getSessionByFile(filePath);
          const hasBridgeBaseline = Boolean(bridgeSession &&
            (bridgeSession.status === "connected" || bridgeSession.messages.length));
          const session = hasBridgeBaseline && bridgeSession
            ? {
                title: bridgeSession.sessionName || path.basename(filePath),
                filePath,
                messages: bridgeSession.messages,
                contextUsage: bridgeSession.contextUsage,
              }
            : readSessionDetail(filePath);
          const settings = readQcodeSettings();
          configureWebviewOptions(settings);
          currentRoute = { name: "sessionDetail", filePath, bridgeId: bridgeSession?.bridgeId };
          const draft = getSessionDraft(filePath);
          view.webview.html = renderSessionDetail(
            filePath,
            getNonce(),
            session,
            {
              initialInput: draft.text,
              initialAttachments: draft.attachments,
              assistantSoundEnabled: settings.assistantSoundEnabled,
              assistantSoundUri: getAssistantSoundWebviewUri(settings),
              mermaidScriptUri: getMermaidScriptWebviewUri(),
              cspSource: view.webview.cspSource,
              waitingForUser: bridgeSession?.waitingForUser,
              waitingForUserMessage: bridgeSession?.waitingForUserMessage,
            },
          );
          if (!hasBridgeBaseline) {
            sessionWatcher = watchSessionDetail(
              session,
              view.webview,
              () => void playConfiguredNotificationSound(view.webview),
            );
          }
        };

        const showNewSessionDetail = () => {
          stopSessionWatcher();
          detailWebviewReady = false;
          const session: SessionDetail = { title: "New Session", messages: [] };
          const settings = readQcodeSettings();
          configureWebviewOptions(settings);
          currentRoute = { name: "sessionDetail" };
          const draft = getSessionDraft("");
          view.webview.html = renderSessionDetail("", getNonce(), session, {
            autoFocus: true,
            initialInput: draft.text,
            initialAttachments: draft.attachments,
            providerOptions: settings.providerOptions,
            lastUsedProviderNickname: settings.lastUsedProviderNickname,
            assistantSoundEnabled: settings.assistantSoundEnabled,
            assistantSoundUri: getAssistantSoundWebviewUri(settings),
            mermaidScriptUri: getMermaidScriptWebviewUri(),
            cspSource: view.webview.cspSource,
          });
        };

        const applyBridgeSession = (bridgeSession: PiTerminalSessionView) => {
          if (bridgeSession.actionError && !shownBridgeActionErrors.has(bridgeSession.actionError)) {
            shownBridgeActionErrors.add(bridgeSession.actionError);
            void vscode.window.showErrorMessage(bridgeSession.actionError);
          }
          if (currentRoute.name !== "sessionDetail") return;
          if (bridgeSession.status !== "connected" && !bridgeSession.messages.length) return;
          const routeMatches = currentRoute.bridgeId === bridgeSession.bridgeId ||
            Boolean(currentRoute.filePath && bridgeSession.sessionFile &&
              path.resolve(currentRoute.filePath) === path.resolve(bridgeSession.sessionFile));
          if (!routeMatches) return;

          stopSessionWatcher();
          if (bridgeSession.playCompletionSound === true) {
            void playConfiguredNotificationSound(view.webview);
          }
          const sessionFileChanged = Boolean(bridgeSession.sessionFile &&
            (!currentRoute.filePath || path.resolve(currentRoute.filePath) !== path.resolve(bridgeSession.sessionFile)));
          if (bridgeSession.sessionFile && sessionFileChanged) {
            currentRoute = {
              name: "sessionDetail",
              filePath: bridgeSession.sessionFile,
              bridgeId: bridgeSession.bridgeId,
            };
            void view.webview.postMessage({
              command: "sessionFileReady",
              filePath: bridgeSession.sessionFile,
              title: bridgeSession.sessionName || path.basename(bridgeSession.sessionFile),
              messages: bridgeSession.messages,
              contextUsage: bridgeSession.contextUsage,
              warnings: [],
              waitingForUser: bridgeSession.waitingForUser,
              waitingForUserMessage: bridgeSession.waitingForUserMessage,
            });
          } else {
            currentRoute = { ...currentRoute, bridgeId: bridgeSession.bridgeId };
            void view.webview.postMessage({
              command: "replaceMessages",
              messages: bridgeSession.messages,
              contextUsage: bridgeSession.contextUsage,
              warnings: [],
              waitingForUser: bridgeSession.waitingForUser,
              waitingForUserMessage: bridgeSession.waitingForUserMessage,
            });
          }
        };

        const bridgeSessionSubscription = terminalSessions.onDidChangeSession(applyBridgeSession);

        const handleSendMessage = async (
          message: Extract<WebviewMessage, { command: "sendMessage" }>,
        ) => {
          try {
            const submittedAttachments = validateChatAttachmentList(
              message.attachments,
            );
            const rawPrompt = serializeQcodeAttachmentPrompt(
              String(message.text || ""),
              submittedAttachments,
            );
            if (!rawPrompt) throw new Error("Message text or an attachment is required.");
            if (Buffer.byteLength(rawPrompt, "utf8") > PI_BRIDGE_MAX_MESSAGE_BYTES) {
              throw new Error(`Message exceeds ${PI_BRIDGE_MAX_MESSAGE_BYTES} bytes.`);
            }
            // A valid submitted message is no longer an unsent draft, even while
            // delivery is pending or the new session file has not been assigned.
            saveSessionDraft(String(message.filePath || ""), { text: "", attachments: [] });
            // Do not let fallback watcher updates clear the optimistic bubble while
            // the terminal and bridge are being created.
            stopSessionWatcher();
            const result = await terminalSessions.sendSessionMessage(
              String(message.filePath || ""),
              rawPrompt,
              String(message.providerCliArgs || ""),
              String(message.clientMessageId || crypto.randomUUID()),
            );
            if (currentRoute.name === "sessionDetail") {
              currentRoute = {
                ...currentRoute,
                bridgeId: result.bridgeId,
                filePath: result.sessionFilePath || currentRoute.filePath,
              };
            }
            const bridgeSession = terminalSessions.getSession(result.bridgeId);
            if (bridgeSession) applyBridgeSession(bridgeSession);
          } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(messageText);
          }
        };

        const handleSavePastedAttachment = async (
          message: Extract<WebviewMessage, { command: "savePastedAttachment" }>,
        ) => {
          const requestId = String(message.requestId || "");
          try {
            const attachment = await savePastedAttachment(message);
            await view.webview.postMessage({
              command: "pastedAttachmentSaved",
              requestId,
              attachment,
            });
          } catch (error) {
            await view.webview.postMessage({
              command: "pastedAttachmentSaveError",
              requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };

        const handleRemovePastedAttachment = async (
          message: Extract<WebviewMessage, { command: "removePastedAttachment" }>,
        ) => {
          const attachment = validateChatAttachment(message.attachment);
          if (!attachment) return;
          await removePastedAttachment(attachment);
        };

        const handleCopyToClipboard = async (
          message: Extract<WebviewMessage, { command: "copyToClipboard" }>,
        ) => {
          await vscode.env.clipboard.writeText(String(message.text || ""));
        };

        const handleOpenFileReference = async (
          message: Extract<WebviewMessage, { command: "openFileReference" }>,
        ) => {
          await openFileReference(String(message.value || ""));
        };

        const handleOpenExternalUrl = async (
          message: Extract<WebviewMessage, { command: "openExternalUrl" }>,
        ) => {
          await openExternalUrl(String(message.value || ""));
        };

        const handleResolveFileReferences = async (
          message: Extract<
            WebviewMessage,
            { command: "resolveFileReferences" }
          >,
        ) => {
          const values = Array.isArray(message.values)
            ? [
                ...new Set(
                  message.values
                    .map((value) => String(value || ""))
                    .filter(Boolean),
                ),
              ]
            : [];
          const results: Record<string, boolean> = {};
          await Promise.all(
            values.map(async (value) => {
              results[value] = await fileReferenceExists(value);
            }),
          );
          await view.webview.postMessage({
            command: "fileReferenceResolution",
            requestId: Number(message.requestId || 0),
            results,
          });
        };

        const handleSearchFiles = async (
          message: Extract<WebviewMessage, { command: "searchFiles" }>,
        ) => {
          const requestId = Number(message.requestId || 0);
          const items = await searchFileSuggestions(
            String(message.query || ""),
          );
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
            configureWebviewOptions(settings);
            await view.webview.postMessage({
              command: "settingsSaved",
              settings,
            });
          } catch (error) {
            await view.webview.postMessage({
              command: "settingsSaveError",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        };

        const handleShowSessionWarnings = async (
          message: Extract<WebviewMessage, { command: "showSessionWarnings" }>,
        ) => {
          const warnings = readWebviewSessionWarnings(message.warnings);
          if (!warnings.length) return;

          await vscode.window.showWarningMessage(
            formatSessionWarnings(warnings),
            { modal: true },
          );
        };

        const handleSaveLastUsedProvider = async (
          message: Extract<WebviewMessage, { command: "saveLastUsedProvider" }>,
        ) => {
          try {
            const settings = readQcodeSettings();
            await writeQcodeSettings({
              ...settings,
              lastUsedProviderNickname: String(message.nickname || ""),
            });
          } catch (error) {
            console.error("Unable to save last used provider:", error);
          }
        };

        const confirmDeleteOption = async (
          message: Extract<
            WebviewMessage,
            | { command: "confirmDeleteHashOption" }
            | { command: "confirmDeleteProviderOption" }
          >,
        ) => {
          const label = String(message.label || "this option");
          const confirmed = await vscode.window.showWarningMessage(
            `Delete ${label}?`,
            { modal: true },
            "Delete",
          );
          if (confirmed !== "Delete") return;

          await view.webview.postMessage({
            command: message.command === "confirmDeleteProviderOption"
              ? "deleteProviderOptionConfirmed"
              : "deleteHashOptionConfirmed",
            index: Number(message.index),
          });
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
          view.webview
            .postMessage({ command: "addToInput", text })
            .then((sent) => {
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

          if (message.command === "setSessionPinned") {
            const workspaceCwd = getWorkspaceCwd();
            const filePath = String(message.filePath || "");
            if (!workspaceCwd) {
              void vscode.window.showInformationMessage(
                "Open a folder to pin sessions for that workspace.",
              );
              return;
            }
            if (
              !isSessionFile(filePath) ||
              sessionPinKey(path.dirname(filePath)) !==
                sessionPinKey(getSessionFolderForCwd(workspaceCwd))
            ) {
              return;
            }

            const workspaceKey = sessionPinKey(workspaceCwd);
            void setSessionPinned(
              workspaceCwd,
              filePath,
              message.pinned === true,
            ).then(() => {
              const currentWorkspaceCwd = getWorkspaceCwd();
              if (
                currentRoute.name === "home" &&
                currentWorkspaceCwd &&
                sessionPinKey(currentWorkspaceCwd) === workspaceKey
              ) {
                showHome();
              }
            }).catch((error) => {
              void vscode.window.showErrorMessage(
                `Unable to save session pin: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
          }

          if (message.command === "newSession") {
            showNewSessionDetail();
          }

          if (
            message.command === "dismissWhatsNew" &&
            message.version === extensionVersion
          ) {
            dismissedWhatsNewVersions.add(extensionVersion);
            void dismissWhatsNewVersion(extensionVersion).catch((error) => {
              dismissedWhatsNewVersions.delete(extensionVersion);
              void vscode.window.showErrorMessage(
                `Unable to save What's new dismissal: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
          }

          if (message.command === "home") {
            if (typeof message.draftText === "string") {
              const attachments = validateChatAttachmentList(
                message.draftAttachments,
              );
              saveSessionDraft(
                String(message.filePath || ""),
                { text: message.draftText, attachments },
              );
            }
            showHome();
          }

          if (message.command === "settings") {
            showSettings();
          }

          if (message.command === "sendMessage") {
            void handleSendMessage(message);
          }

          if (message.command === "savePastedAttachment") {
            void handleSavePastedAttachment(message);
          }

          if (message.command === "removePastedAttachment") {
            void handleRemovePastedAttachment(message);
          }

          if (message.command === "copyToClipboard") {
            void handleCopyToClipboard(message);
          }

          if (message.command === "openFileReference") {
            void handleOpenFileReference(message);
          }

          if (message.command === "openExternalUrl") {
            void handleOpenExternalUrl(message);
          }

          if (message.command === "resolveFileReferences") {
            void handleResolveFileReferences(message);
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

          if (message.command === "saveLastUsedProvider") {
            void handleSaveLastUsedProvider(message);
          }

          if (message.command === "showSessionWarnings") {
            void handleShowSessionWarnings(message);
          }

          if (message.command === "playNotificationSound") {
            void playConfiguredNotificationSound(view.webview);
          }

          if (
            message.command === "confirmDeleteHashOption" ||
            message.command === "confirmDeleteProviderOption"
          ) {
            void confirmDeleteOption(message);
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
            bridgeSessionSubscription.dispose();
            addToActiveQcodeInput = undefined;
          },
        });
      },
    }),
  );
}

async function getSelectedTerminalText(): Promise<string> {
  if (!vscode.window.activeTerminal) return "";

  const previousClipboardText = await vscode.env.clipboard.readText();
  const sentinelClipboardText = `qcode-terminal-selection-${Date.now()}-${Math.random()}`;

  try {
    await vscode.env.clipboard.writeText(sentinelClipboardText);
    await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
    await delay(50);

    const selectedText = await vscode.env.clipboard.readText();
    if (!selectedText || selectedText === sentinelClipboardText) return "";

    return `Terminal selection:\n\`\`\`terminal\n${trimTrailingLineEndings(selectedText)}\n\`\`\`\n`;
  } finally {
    await vscode.env.clipboard.writeText(previousClipboardText);
  }
}

function getSelectedEditorText(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";

  const selectedText = editor.selections
    .map((selection) =>
      trimTrailingLineEndings(editor.document.getText(selection)),
    )
    .filter(Boolean)
    .join("\n");
  if (!selectedText) return "";

  return `@${getRelativeEditorPath(editor)}\n\`\`\`\n${selectedText}\n\`\`\`\n`;
}

function trimTrailingLineEndings(value: string): string {
  return value.replace(/(?:\r?\n|\r)+$/, "");
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
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function getWorkspaceCwd(): string | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  return workspaceFolder ? workspaceFolder.uri.fsPath : undefined;
}

export function readStoredSessionDrafts(value: unknown): Map<string, SessionDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  return new Map(
    Object.entries(value)
      .map(([key, draft]): [string, SessionDraft] => [key, normalizeSessionDraft(draft)])
      .filter(([, draft]) => Boolean(draft.text || draft.attachments.length)),
  );
}

function readWebviewSessionWarnings(value: unknown): SessionWarning[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const warning = item as Record<string, unknown>;
      const id = typeof warning.id === "string" ? warning.id : "session-warning";
      const title = typeof warning.title === "string" ? warning.title.trim() : "Session warning";
      const message = typeof warning.message === "string" ? warning.message.trim() : "";
      return message ? { id, title, message } : undefined;
    })
    .filter((warning): warning is SessionWarning => Boolean(warning));
}

function formatSessionWarnings(warnings: SessionWarning[]): string {
  if (warnings.length === 1) {
    return `${warnings[0].title}\n\n${warnings[0].message}`;
  }

  return warnings
    .map((warning) => `${warning.title}\n${warning.message}`)
    .join("\n\n");
}

export function deactivate(): void {}
