import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { RecentSession } from "../sessionFiles";
import {
  getSessionPinnedAt,
  readSessionPins,
  sessionPinKey,
  setSessionPinned,
} from "../sessionPins";
import { groupSessions, renderHome } from "../webviews/home";

function session(filePath: string, lastActiveAt: Date): RecentSession {
  return {
    id: filePath,
    cwd: "/workspace",
    model: "model",
    messageCount: 1,
    totalTokens: 0,
    filePath,
    fileName: filePath,
    title: filePath,
    preview: filePath,
    createdAt: lastActiveAt,
    lastActiveAt,
  };
}

test("groups pinned sessions first in newest-pin order", () => {
  const olderSession = session("/sessions/older.jsonl", new Date("2020-01-01"));
  const newerSession = session("/sessions/newer.jsonl", new Date("2025-01-01"));
  const unpinnedSession = session("/sessions/unpinned.jsonl", new Date());
  const pins = new Map([
    [sessionPinKey(newerSession.filePath), 100],
    [sessionPinKey(olderSession.filePath), 200],
  ]);

  const groups = groupSessions(
    [unpinnedSession, olderSession, newerSession],
    pins,
  );

  assert.deepEqual(groups.Pinned, [olderSession, newerSession]);
  assert.deepEqual(groups.Today, [unpinnedSession]);
});

test("stores pins in folderSettings for their respective workspaces", async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-pins-"));
  const settingsFilePath = path.join(tempDirectory, "settings.json");
  const firstFolder = path.join(tempDirectory, "first-workspace");
  const secondFolder = path.join(tempDirectory, "second-workspace");
  const firstSession = path.join(tempDirectory, "sessions", "one.jsonl");
  const secondSession = path.join(tempDirectory, "sessions", "two.jsonl");

  try {
    await setSessionPinned(firstFolder, firstSession, true, settingsFilePath);
    await setSessionPinned(secondFolder, secondSession, true, settingsFilePath);

    const storedValue = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
    assert.deepEqual(
      storedValue.folderSettings.map((folder: { path: string }) => folder.path),
      [path.resolve(firstFolder), path.resolve(secondFolder)],
    );
    assert.equal(Array.isArray(storedValue.folderSettings[0].pinned), true);

    const firstPins = readSessionPins(firstFolder, settingsFilePath);
    assert.equal(getSessionPinnedAt(firstPins, firstSession) !== undefined, true);
    assert.equal(getSessionPinnedAt(firstPins, secondSession), undefined);

    const secondPins = readSessionPins(secondFolder, settingsFilePath);
    assert.equal(getSessionPinnedAt(secondPins, secondSession) !== undefined, true);
    assert.equal(getSessionPinnedAt(secondPins, firstSession), undefined);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("removes an unpinned session from its workspace settings", async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-pins-"));
  const settingsFilePath = path.join(tempDirectory, "settings.json");
  const folderPath = path.join(tempDirectory, "workspace");
  const sessionPath = path.join(tempDirectory, "sessions", "one.jsonl");

  try {
    await setSessionPinned(folderPath, sessionPath, true, settingsFilePath);
    await setSessionPinned(folderPath, sessionPath, false, settingsFilePath);

    assert.equal(readSessionPins(folderPath, settingsFilePath).size, 0);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("home exposes a one-item session pin context menu", () => {
  const html = renderHome(
    "nonce",
    "/path/that/does/not/exist",
    "1.0.0",
  );

  assert.match(html, /id="session-context-menu"[\s\S]*>Pin<\/button>/);
  assert.match(html, /addEventListener\('contextmenu'/);
  assert.match(html, /command: 'setSessionPinned'/);
});
