import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { PiTerminalSessions } from "../piTerminalSessions";
import { readQcodeSettings, saveSlackShareThread, writeQcodeSettings } from "../qcodeSettings";
import { SlackShare } from "../slackShare";
import { renderSessionDetail } from "../webviews/sessionDetail";

const draft = { title: "New Session", messages: [] };

test("Slack checkbox defaults to checked below Provider, only for globally enabled drafts", () => {
  const options = {
    slackShareEnabled: true,
    providerOptions: [{ nickname: "Work", cliArgs: "--model example/model" }],
  };
  const html = renderSessionDetail("", "nonce", draft, options);
  assert.match(html, /<input type="checkbox" id="draft-slack-share-enabled" checked>/);
  assert.ok(html.indexOf('</select>') < html.indexOf('<label class="draft-slack-share"'));
  assert.match(renderSessionDetail("", "nonce", draft, { slackShareEnabled: true }), /<input type="checkbox" id="draft-slack-share-enabled" checked>/);
  for (const hidden of [
    renderSessionDetail("", "nonce", draft),
    renderSessionDetail("", "nonce", draft, { ...options, slackShareEnabled: false }),
    renderSessionDetail("/tmp/session.jsonl", "nonce", { ...draft, filePath: "/tmp/session.jsonl" }, options),
    renderSessionDetail("", "nonce", { ...draft, error: "Unavailable" }, options),
  ]) {
    assert.doesNotMatch(hidden, /<input[^>]+id="draft-slack-share-enabled"/);
  }
});

test("submission captures checkbox choice (hidden means false), retaining it after draft controls are removed", () => {
  const html = renderSessionDetail("", "nonce", draft, { slackShareEnabled: true });
  const script = html.slice(html.indexOf("let selectedDraftSlackShare"), html.indexOf("const initialInput"));
  for (const checked of [true, false, undefined]) {
    let checkbox = checked === undefined ? undefined : { checked };
    const context = vm.createContext({
      document: { getElementById: (id: string) => id === "draft-slack-share-enabled"
        ? checkbox : { remove: () => { checkbox = undefined; } } },
    });
    vm.runInContext(script, context);
    assert.equal(vm.runInContext("getDraftSlackShareEnabled()", context), checked === true);
    vm.runInContext("removeDraftProviderOptions()", context);
    assert.equal(vm.runInContext("getDraftSlackShareEnabled()", context), checked === true);
  }
  assert.match(html, /slackShareEnabled: form\.dataset\.filePath \? undefined : getDraftSlackShareEnabled\(\)/);
  assert.match(html, /data\.command === 'sessionFileReady'[\s\S]*removeDraftProviderOptions\(\)/);
});

test("session opt-in gates thread creation and persists across reopen and global off/on", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-session-slack-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const settingsFile = path.join(cwd, "settings.json");
  await writeQcodeSettings({ slackShare: { enabled: true, userToken: "user", botToken: "bot", channelId: "C1" } }, settingsFile);
  const posts: string[] = [];
  const shareOptions = {
    readSettings: () => readQcodeSettings(settingsFile),
    saveThread: (thread: Parameters<typeof saveSlackShareThread>[0]) => saveSlackShareThread(thread, settingsFile),
    showError: (error: string) => { assert.fail(error); },
    api: {
      post: async (_token: string, _channel: string, text: string) => { posts.push(text); return "123.456"; },
      upload: async () => {},
    },
  };
  const share = new SlackShare(shareOptions);
  const modulePath = require.resolve("../piTerminalSessions");
  const realRequire = createRequire(modulePath);
  const exports: { PiTerminalSessions?: typeof PiTerminalSessions } = {};
  vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), {
    exports, console, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (id: string) => id === "vscode" ? {
      EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
      env: { sessionId: "test", shell: "/bin/bash" },
      workspace: { workspaceFolders: [{ uri: { fsPath: cwd } }] },
      Uri: { joinPath: (uri: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(uri.fsPath, ...parts) }) },
      window: {
        onDidCloseTerminal: () => ({ dispose() {} }),
        createTerminal: () => ({ sendText() {} }),
      },
    } : id === "./qcodeSettings" ? { readQcodeSettings: shareOptions.readSettings }
      : id === "./slackShare" ? { SlackShare: class { constructor() { return share; } } }
      : realRequire(id),
  });
  const sessions = new exports.PiTerminalSessions!({
    subscriptions: [], globalStorageUri: { fsPath: cwd }, extensionUri: { fsPath: cwd },
    workspaceState: { get: () => "", update: async () => {} },
  } as never);
  t.after(() => sessions.dispose());
  const internals = sessions as unknown as {
    sessions: Map<string, unknown>;
    handleBridgeMessage(session: unknown, message: unknown): void;
  };
  const setGlobal = async (enabled: boolean) => {
    const settings = shareOptions.readSettings();
    await writeQcodeSettings({ ...settings, slackShare: { ...settings.slackShare, enabled } }, settingsFile);
  };
  const start = async (name: string, enabled?: boolean) => {
    const result = await sessions.sendSessionMessage({
      filePath: "", text: name, clientMessageId: name,
      ...(enabled === undefined ? {} : { slackShareEnabled: enabled }),
    });
    const file = path.join(cwd, `${name}.jsonl`);
    const session = internals.sessions.get(result.bridgeId);
    internals.handleBridgeMessage(session, { type: "hello", sequence: 1, sessionFile: file, idle: true });
    internals.handleBridgeMessage(session, { type: "session_snapshot", sequence: 2, entries: [] });
    internals.handleBridgeMessage(session, { type: "user_input", sequence: 3, text: `${name} terminal input` });
    await share.whenIdle();
    return file;
  };
  const optedIn = await start("opted-in", true);
  const optedOut = await start("opted-out", false);
  const omitted = await start("omitted");
  await setGlobal(false);
  const globallyOff = await start("globally-off", true);
  share.shareUser(optedIn, "paused user");
  share.shareAssistant(optedIn, "paused assistant");
  await share.whenIdle();
  assert.deepEqual(posts, ["qcode: opted-in", "qcode: opted-in terminal input"]);

  await setGlobal(true);
  const reopened = new SlackShare(shareOptions);
  for (const file of [optedOut, omitted, globallyOff]) {
    reopened.shareUser(file, "must stay private");
    reopened.shareAssistant(file, "must also stay private");
  }
  reopened.shareUser(optedIn, "resumed user");
  reopened.shareAssistant(optedIn, "resumed assistant");
  await reopened.whenIdle();
  assert.deepEqual(posts, ["qcode: opted-in", "qcode: opted-in terminal input", "qcode: resumed user", "resumed assistant"]);
  assert.equal(shareOptions.readSettings().slackShareThreads.length, 1);
});
