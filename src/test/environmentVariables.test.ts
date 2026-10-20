import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as vm from "node:vm";
import {
  readEnvironmentVariables,
  resolveEnvironmentFilePath,
} from "../environmentVariables";
import { readQcodeSettings, writeQcodeSettings } from "../qcodeSettings";
import type { PiTerminalSessions } from "../piTerminalSessions";

function temporaryDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-env-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("settings round-trip environment files and provider selections; old settings still work", async (t) => {
  const file = path.join(temporaryDirectory(t), "settings.json");
  assert.deepEqual(readQcodeSettings(file).environmentVariables, []);
  const settings = await writeQcodeSettings({
    environmentVariables: [null, {}, { title: " Work ", value: " ~/work/.env " }],
    providerOptions: [
      { nickname: "work", cliArgs: "--model example/model", environmentVariables: " Work " },
      { nickname: "default", cliArgs: "--model other/model" },
    ],
  }, file);
  assert.deepEqual(settings.environmentVariables, [{ title: "Work", value: "~/work/.env" }]);
  assert.equal(settings.providerOptions[0].environmentVariables, "Work");
  assert.deepEqual(settings.providerOptions[1], { nickname: "default", cliArgs: "--model other/model" });
  assert.deepEqual(readQcodeSettings(file), settings);
});

test("loads dotenv syntax as data, rereads files, and does not mutate process.env", (t) => {
  const cwd = temporaryDirectory(t);
  const file = path.join(cwd, ".env");
  fs.writeFileSync(file, [
    "# comment",
    "export QCODE_ENV_TEST=secret # trailing comment",
    'QUOTED="spaces # hash = equals"',
    "SINGLE='literal $HOME'",
    'MULTILINE="first\nsecond"',
    "EMPTY=",
    "COMMAND=$(touch should-not-exist)",
    "DUPLICATE=first",
    "DUPLICATE=last",
  ].join("\r\n"));
  const settings = { environmentVariables: [{ title: "Work", value: ".env" }] };
  const before = process.env.QCODE_ENV_TEST;
  assert.deepEqual(readEnvironmentVariables(settings, "Work", cwd), {
    QCODE_ENV_TEST: "secret",
    QUOTED: "spaces # hash = equals",
    SINGLE: "literal $HOME",
    MULTILINE: "first\nsecond",
    EMPTY: "",
    COMMAND: "$(touch should-not-exist)",
    DUPLICATE: "last",
  });
  assert.equal(process.env.QCODE_ENV_TEST, before);
  fs.writeFileSync(file, "CHANGED=yes");
  assert.deepEqual(readEnvironmentVariables(settings, "Work", cwd), { CHANGED: "yes" });
  assert.equal(resolveEnvironmentFilePath(file, cwd), file);
  assert.equal(resolveEnvironmentFilePath("~/work/.env", cwd), path.join(os.homedir(), "work/.env"));
  assert.equal(resolveEnvironmentFilePath("~\\work/.env", cwd), path.join(os.homedir(), "work/.env"));
});

test("no selection inherits the environment; missing selections/files fail explicitly", (t) => {
  const cwd = temporaryDirectory(t);
  const settings = { environmentVariables: [{ title: "Missing", value: ".env" }] };
  assert.deepEqual(readEnvironmentVariables(settings, "", cwd), {});
  assert.throws(() => readEnvironmentVariables(settings, "Unknown", cwd), /was not found/);
  assert.throws(() => readEnvironmentVariables(settings, "Missing", cwd), /Unable to load.*ENOENT/);
});

test("new Pi terminals receive only the selected environment and preserve bridge credentials", async (t) => {
  const cwd = temporaryDirectory(t);
  fs.writeFileSync(path.join(cwd, ".env"), [
    "QCODE_ENV_TEST=selected",
    "QCODE_BRIDGE_TOKEN=bad-token",
    "QCODE_BRIDGE_ID=bad-id",
    "QCODE_BRIDGE_REGISTRATION=bad-path",
    "QCODE_INITIAL_CLIENT_MESSAGE_ID=bad-client",
    "PI_CACHE_RETENTION=short",
  ].join("\n"));
  const settings = {
    environmentVariables: [{ title: "Work", value: ".env" }],
    providerOptions: [{ nickname: "work", cliArgs: "--model openai-codex/gpt-5.5", environmentVariables: "Work" }],
  };
  const terminals: { env: Record<string, string>; commands: string[] }[] = [];
  const stored = new Map<string, string>();
  const vscode = {
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire() {}
      dispose() {}
    },
    env: { sessionId: "test", shell: "/bin/bash" },
    workspace: { workspaceFolders: [{ uri: { fsPath: cwd } }] },
    Uri: { joinPath: (uri: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(uri.fsPath, ...parts) }) },
    window: {
      onDidCloseTerminal: () => ({ dispose() {} }),
      createTerminal: (options: { env: Record<string, string> }) => {
        const terminal = { ...options, commands: [] as string[], sendText(text: string) { this.commands.push(text); } };
        terminals.push(terminal);
        return terminal;
      },
    },
  };
  // Execute the compiled module with a VS Code boundary stub, leaving launch logic real.
  const modulePath = require.resolve("../piTerminalSessions");
  const realRequire = createRequire(modulePath);
  const exports: { PiTerminalSessions?: typeof PiTerminalSessions } = {};
  vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), {
    exports, console, process, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (id: string) => id === "vscode" ? vscode
      : id === "./qcodeSettings" ? { readQcodeSettings: () => settings }
      : realRequire(id),
  });
  const context = {
    subscriptions: [],
    globalStorageUri: { fsPath: cwd },
    extensionUri: { fsPath: cwd },
    workspaceState: {
      get: (key: string, fallback?: string) => stored.get(key) ?? fallback,
      update: async (key: string, value: string) => { stored.set(key, value); },
    },
  };
  const sessions = new exports.PiTerminalSessions!(context as never);
  t.after(() => sessions.dispose());
  const started = await sessions.sendSessionMessage({
    filePath: "", text: "hello", providerCliArgs: settings.providerOptions[0].cliArgs,
    clientMessageId: "client", providerNickname: "work", slackShareEnabled: false,
  });
  const env = terminals[0].env;
  assert.equal(env.QCODE_ENV_TEST, "selected");
  assert.notEqual(env.QCODE_BRIDGE_TOKEN, "bad-token");
  assert.notEqual(env.QCODE_BRIDGE_ID, "bad-id");
  assert.notEqual(env.QCODE_BRIDGE_REGISTRATION, "bad-path");
  assert.equal(env.QCODE_INITIAL_CLIENT_MESSAGE_ID, "client");
  assert.equal(env.PI_CACHE_RETENTION, "short");
  assert.ok(!terminals[0].commands.join().includes("selected"));
  assert.equal(process.env.QCODE_ENV_TEST, undefined);

  await sessions.sendSessionMessage({
    filePath: "", text: "default", clientMessageId: "client-default",
    providerNickname: "", slackShareEnabled: false,
  });
  assert.equal(terminals[1].env.QCODE_ENV_TEST, undefined);

  // Simulate Pi assigning a session file, then recreate the manager as after a reload.
  const sessionFile = path.join(os.homedir(), ".pi", "agent", "sessions", "qcode-env-test.jsonl");
  const bridge = sessions as unknown as {
    sessions: Map<string, unknown>;
    handleBridgeMessage(session: unknown, message: unknown): void;
  };
  bridge.handleBridgeMessage(bridge.sessions.get(started.bridgeId), {
    type: "session_state", sequence: 1, state: { sessionFile },
  });
  assert.ok([...stored.values()].includes("work"));
  sessions.dispose();
  const resumed = new exports.PiTerminalSessions!(context as never);
  t.after(() => resumed.dispose());
  fs.writeFileSync(path.join(cwd, ".env"), "QCODE_ENV_TEST=reloaded");
  await resumed.sendSessionMessage({ filePath: sessionFile, text: "resume", slackShareEnabled: false });
  assert.equal(terminals[2].env.QCODE_ENV_TEST, "reloaded");
  assert.match(terminals[2].commands.join(), /--session/);

  fs.unlinkSync(path.join(cwd, ".env"));
  await assert.rejects(resumed.sendSessionMessage({
    filePath: "", text: "missing", providerCliArgs: settings.providerOptions[0].cliArgs,
    clientMessageId: "client", providerNickname: "work", slackShareEnabled: false,
  }), /Unable to load/);
  assert.equal(terminals.length, 3);
});
