import * as assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { HomeSessions } from "../homeSessions";
import type { PiTerminalSessionView } from "../piTerminalSessions";
import { getSessionFolderForCwd, type RecentSession } from "../sessionFiles";
import { renderHome, renderHomeSessionList } from "../webviews/home";

const cwd = "/workspace";
const filePath = path.join(getSessionFolderForCwd(cwd), "session.jsonl");
const now = new Date();
const saved: RecentSession = {
  id: "session-id", cwd, filePath, fileName: "session.jsonl",
  title: "Saved title", preview: "Saved preview", model: "model",
  messageCount: 2, totalTokens: 100, createdAt: now, lastActiveAt: now,
};
function bridge(overrides: Partial<PiTerminalSessionView> = {}): PiTerminalSessionView {
  return {
    bridgeId: "bridge", status: "connecting", busy: true,
    terminalExited: false, waitingForUser: false,
    messages: [{ role: "user", text: "First prompt" }],
    ...overrides,
  };
}

test("a new session is listed before a file or session ID exists", () => {
  const sessions = new HomeSessions();
  sessions.update(bridge(), cwd, now);
  const rows = sessions.merge([], cwd);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].filePath, "");
  assert.equal(rows[0].bridgeId, "bridge");
  assert.equal(rows[0].title, "First prompt");
  assert.equal(rows[0].busy, true);
  assert.match(renderHomeSessionList(rows), /data-bridge-id="bridge"/);
});

test("file assignment updates the optimistic row and merges persisted metadata without duplicates", () => {
  const sessions = new HomeSessions();
  sessions.update(bridge(), cwd, now);
  sessions.update(bridge({ sessionFile: filePath, sessionId: saved.id }), cwd, now);
  assert.equal(sessions.merge([], cwd).length, 1, "file may still not exist");
  const rows = sessions.merge([saved], cwd);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].filePath, filePath);
  assert.equal(rows[0].title, saved.title);
  assert.equal(rows[0].totalTokens, 100);
  assert.equal(rows[0].busy, true);
});

test("deduplicates by normalized file path or authoritative session ID, never prompt text", () => {
  const sessions = new HomeSessions();
  sessions.update(bridge({ sessionFile: path.join(path.dirname(filePath), "sub", "..", "session.jsonl") }), cwd);
  assert.equal(sessions.merge([saved], cwd).length, 1);

  const byId = new HomeSessions();
  byId.update(bridge({ sessionId: saved.id }), cwd);
  assert.equal(byId.merge([saved], cwd).length, 1);
  byId.update(bridge({ bridgeId: "second-bridge" }), cwd);
  assert.equal(byId.merge([saved], cwd).length, 2);
});

test("settling refreshes saved metadata and replaces busy with relative time", () => {
  const sessions = new HomeSessions();
  sessions.update(bridge({ sessionFile: filePath }), cwd);
  const busyHtml = renderHomeSessionList(sessions.merge([saved], cwd));
  assert.match(busyHtml, /<span class="busy">busy<\/span>/);
  assert.doesNotMatch(busyHtml, /just now|ago/);

  sessions.update(bridge({ sessionFile: filePath, status: "connected", busy: false }), cwd);
  const rows = sessions.merge([{ ...saved, preview: "Updated preview", messageCount: 3 }], cwd);
  assert.equal(rows[0].preview, "Updated preview");
  assert.equal(rows[0].messageCount, 3);
  const settledHtml = renderHomeSessionList(rows);
  assert.doesNotMatch(settledHtml, /class="busy"/);
  assert.match(settledHtml, /just now/);
});

test("terminal failure clears busy even without a persisted session", () => {
  const sessions = new HomeSessions();
  sessions.update(bridge(), cwd);
  sessions.update(bridge({ busy: false, status: "terminal_exited", terminalExited: true }), cwd);
  assert.equal(sessions.merge([], cwd)[0].busy, false);
});

test("only includes live rows for the current workspace", () => {
  const sessions = new HomeSessions();
  sessions.update(bridge(), "/other-workspace");
  sessions.update(bridge({ bridgeId: "other-file", sessionFile: filePath }), cwd);
  assert.equal(sessions.merge([], cwd).length, 1);
  assert.equal(sessions.merge([], "/other-workspace").length, 1);
});

test("home supports in-place refreshes and keeps metadata escaped", () => {
  const html = renderHome("nonce", "/nonexistent", "1.0", undefined, new Map(), {}, [
    { ...saved, busy: true, model: "<model>" },
  ]);
  assert.match(html, /\.busy \{ color: var\(--vscode-textLink-foreground/);
  assert.match(html, /&lt;model&gt;/);
  assert.match(html, /command: 'homeReady'/);
  assert.match(html, /event.data.command !== 'refreshHomeSessions'/);
  assert.match(html, /list.addEventListener\('click'/);
  assert.match(html, /list.scrollTop = scrollTop/);
});
