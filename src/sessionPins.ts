import * as path from "node:path";
import {
  readQcodeSettings,
  writeQcodeSettings,
  type QcodeSettings,
} from "./qcodeSettings";

export function sessionPinKey(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

export function readSessionPins(
  folderPath: string,
  settingsFilePath?: string,
): Map<string, number> {
  return readSessionPinsFromSettings(
    readQcodeSettings(settingsFilePath),
    folderPath,
  );
}

export function readSessionPinsFromSettings(
  settings: QcodeSettings,
  folderPath: string,
): Map<string, number> {
  const folderKey = sessionPinKey(folderPath);
  const folder = settings.folderSettings.find(
    (item) => sessionPinKey(item.path) === folderKey,
  );

  return new Map(
    (folder?.pinned ?? []).map((pin) => [
      sessionPinKey(pin.filePath),
      pin.pinnedAt,
    ]),
  );
}

export async function setSessionPinned(
  folderPath: string,
  pinnedFilePath: string,
  pinned: boolean,
  settingsFilePath?: string,
): Promise<void> {
  const settings = readQcodeSettings(settingsFilePath);
  await writeQcodeSettings(
    updateSessionPinSettings(
      settings,
      folderPath,
      pinnedFilePath,
      pinned,
    ),
    settingsFilePath,
  );
}

export function updateSessionPinSettings(
  settings: QcodeSettings,
  folderPath: string,
  pinnedFilePath: string,
  pinned: boolean,
): QcodeSettings {
  const normalizedFolderPath = path.resolve(folderPath);
  const folderKey = sessionPinKey(normalizedFolderPath);
  const folderSettings = settings.folderSettings.map((folder) => ({
    ...folder,
    pinned: [...folder.pinned],
  }));
  let folder = folderSettings.find(
    (item) => sessionPinKey(item.path) === folderKey,
  );

  if (!folder) {
    folder = { path: normalizedFolderPath, pinned: [] };
    folderSettings.push(folder);
  }

  const pinKey = sessionPinKey(pinnedFilePath);
  folder.pinned = folder.pinned.filter(
    (pin) => sessionPinKey(pin.filePath) !== pinKey,
  );

  if (pinned) {
    const latestPinnedAt = folder.pinned.reduce(
      (latest, pin) => Math.max(latest, pin.pinnedAt),
      0,
    );
    folder.pinned.push({
      filePath: path.resolve(pinnedFilePath),
      pinnedAt: Math.max(Date.now(), latestPinnedAt + 1),
    });
  }

  return { ...settings, folderSettings };
}

export function getSessionPinnedAt(
  pins: ReadonlyMap<string, number>,
  filePath: string,
): number | undefined {
  return pins.get(sessionPinKey(filePath));
}
