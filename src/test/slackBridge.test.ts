import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { PiTerminalSessions } from "../piTerminalSessions";
import { readQcodeSettings } from "../qcodeSettings";

test("bridge shares new sessions, live users and final settled replies, never snapshots/commentary/replays", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-slack-bridge-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const settings = readQcodeSettings("");
  settings.slackShare = { enabled: true, userToken: "user", botToken: "bot", channelId: "C1" };
  const shared: { kind: string; file: string; text: string }[] = [];
  const errors: string[] = [];
  let showError!: (message: string) => void;
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
        showErrorMessage: (message: string) => { errors.push(message); },
      },
    } : id === "./qcodeSettings" ? { readQcodeSettings: () => settings }
      : id === "./slackShare" ? {
        SlackShare: class {
          constructor(options: { showError: typeof showError }) { showError = options.showError; }
          startSession(file: string, text: string) { shared.push({ kind: "start", file, text }); }
          shareUser(file: string, text: string) { shared.push({ kind: "user", file, text }); }
          shareAssistant(file: string, text: string) { shared.push({ kind: "assistant", file, text }); }
        },
      } : realRequire(id),
  });
  const sessions = new exports.PiTerminalSessions!({
    subscriptions: [], globalStorageUri: { fsPath: cwd }, extensionUri: { fsPath: cwd },
    workspaceState: { get: () => "", update: async () => {} },
  } as never);
  t.after(() => sessions.dispose());
  const internals = sessions as unknown as {
    sessions: Map<string, unknown>;
    handleBridgeMessage(session: unknown, message: unknown): void;
    sendCommand: () => Promise<void>;
  };
  const started = await sessions.sendSessionMessage({
    filePath: "", text: "first", clientMessageId: "initial", slackShareEnabled: true,
  });
  const session = internals.sessions.get(started.bridgeId);
  let sequence = 0;
  const event = (message: Record<string, unknown>) => internals.handleBridgeMessage(session, { ...message, sequence: ++sequence });
  const file = path.join(cwd, "session.jsonl");
  event({ type: "hello", sessionFile: file, idle: true });
  event({ type: "user_input", text: "first", clientMessageId: "initial" });
  event({ type: "session_snapshot", entries: [] });
  event({ type: "session_state", state: { sessionFile: file } });
  assert.deepEqual(shared, [{ kind: "start", file, text: "first" }]);

  event({ type: "agent_start" });
  const reply = (text: string, stopReason = "stop") => event({ type: "message_end", message: {
    role: "assistant", content: [{ type: "text", text }], stopReason,
  } });
  reply("intermediate", "toolUse");
  event({ type: "tool_execution_start", toolName: "read" });
  reply("final");
  assert.equal(shared.length, 1, "message_end alone must not share an assistant reply");
  event({ type: "agent_settled" });
  event({ type: "agent_settled" });
  assert.equal(shared.at(-1)?.text, "final");
  assert.equal(shared.length, 2);

  // A new user send can emit bridge events before its command acknowledgement.
  internals.sendCommand = async () => {
    event({ type: "user_input", text: "next", clientMessageId: "next-id" });
    event({ type: "message_start", message: { role: "user", content: "next" } });
    event({ type: "agent_start" });
    reply("next answer");
    event({ type: "agent_settled" });
  };
  await sessions.sendSessionMessage({
    filePath: "", text: "next", clientMessageId: "next-id",
    requestedBridgeId: started.bridgeId, slackShareEnabled: true,
  });
  assert.deepEqual(shared.slice(-2).map(({ kind, text }) => ({ kind, text })), [
    { kind: "user", text: "next" }, { kind: "assistant", text: "next answer" },
  ]);
  assert.equal(shared.length, 4, "acknowledgement must not duplicate the raw input event");

  event({ type: "agent_start" });
  reply("commentary");
  event({ type: "message_start", message: { role: "assistant", content: [] } });
  reply("", "aborted");
  event({ type: "agent_settled" });
  assert.equal(shared.length, 4, "empty/aborted final reply cannot leak previous commentary");

  event({ type: "hello", sessionFile: file, idle: true });
  event({ type: "user_input", text: "disconnected backlog" });
  event({ type: "session_snapshot", entries: [
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "historical answer" }] } },
  ] });
  event({ type: "agent_settled" });
  assert.equal(shared.length, 4);
  event({ type: "user_input", text: "live terminal input" });
  assert.equal(shared.at(-1)?.text, "live terminal input");
  showError("Slack Share message failed: missing_scope");
  assert.deepEqual(errors, ["Slack Share message failed: missing_scope"]);

  settings.slackShare.enabled = false;
  const disabled = await sessions.sendSessionMessage({
    filePath: "", text: "disabled session", slackShareEnabled: true,
  });
  settings.slackShare.enabled = true;
  internals.handleBridgeMessage(internals.sessions.get(disabled.bridgeId), {
    type: "hello", sequence: 1, sessionFile: `${file}-disabled`, idle: true,
  });
  assert.equal(shared.filter((item) => item.kind === "start").length, 1, "enabling later must not start sharing an existing session");
});
