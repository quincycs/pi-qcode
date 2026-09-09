import * as path from "node:path";
import type * as vscode from "vscode";
import type { PiTerminalSessionView } from "./piTerminalSessions";
import { getSessionFolderForCwd } from "./sessionFiles";
import { sessionPinKey } from "./sessionPins";

/** Listen independently of the sidebar's lifetime and selected session. */
export function watchSessionCompletionSounds(
  onDidChangeSession: vscode.Event<PiTerminalSessionView>,
  getWorkspaceCwd: () => string | undefined,
  playSound: () => void,
): vscode.Disposable {
  return onDidChangeSession((session) => {
    if (!session.playCompletionSound || !session.sessionFile) return;
    const cwd = getWorkspaceCwd();
    if (!cwd) return;
    if (sessionPinKey(path.dirname(session.sessionFile)) !==
      sessionPinKey(getSessionFolderForCwd(cwd))) return;

    playSound();
  });
}
