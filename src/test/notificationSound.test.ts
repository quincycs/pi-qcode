import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "node:path";
import * as vm from "node:vm";
import type { PiTerminalSessionView } from "../piTerminalSessions";
import { readQcodeSettings } from "../qcodeSettings";
import { getSessionFolderForCwd } from "../sessionFiles";
import { watchSessionCompletionSounds } from "../sessionNotifications";
import { renderHome } from "../webviews/home";
import { renderSettings } from "../webviews/settings";
import { renderNotificationSoundScript } from "../webviews/notificationSound";
import { getNotificationSoundCommands } from "../notificationSound";
import { renderSessionDetail } from "../webviews/sessionDetail";

test("uses afplay directly on macOS without a shell", () => {
  assert.deepEqual(
    getNotificationSoundCommands("/tmp/a sound.wav", "darwin"),
    [{ command: "afplay", args: ["/tmp/a sound.wav"] }],
  );
});

test("passes Windows sound paths through the child environment", () => {
  const commands = getNotificationSoundCommands("C:\\Sounds\\done.wav", "win32");

  assert.deepEqual(commands.map(({ command }) => command), ["powershell.exe", "pwsh.exe"]);
  assert.equal(commands[0]?.env?.QCODE_NOTIFICATION_SOUND, "C:\\Sounds\\done.wav");
  assert.doesNotMatch(commands[0]?.args.join(" ") ?? "", /C:\\Sounds/);
});

test("provides common Linux audio-player fallbacks", () => {
  assert.deepEqual(
    getNotificationSoundCommands("/tmp/done.wav", "linux").map(({ command }) => command),
    ["paplay", "aplay", "ffplay"],
  );
});

test("asks the extension host to play sounds and retains a webview fallback", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "New Session",
    messages: [],
  }, {
    assistantSoundEnabled: true,
    assistantSoundUri: "sound.wav",
  });

  assert.match(html, /vscode\.postMessage\(\{ command: 'playNotificationSound' \}\)/);
  assert.match(html, /event\.data\?\.command === 'playNotificationSoundFallback'/);
  assert.match(html, /playNotificationSoundInWebview\(\)/);
  assert.doesNotMatch(html, /playAssistantSound/);
  assert.doesNotMatch(html, /replaceWatchedMessages/);
});

test("completion sounds observe every session in the current folder without a webview", () => {
  let listener: ((session: PiTerminalSessionView) => void) | undefined;
  let cwd: string | undefined = path.resolve("workspace-a");
  let sounds = 0;
  const subscription = watchSessionCompletionSounds(
    (callback) => {
      listener = callback;
      return { dispose: () => { listener = undefined; } };
    },
    () => cwd,
    () => { sounds += 1; },
  );
  const session = (name: string, folder = cwd!): PiTerminalSessionView => ({
    bridgeId: name,
    sessionFile: path.join(getSessionFolderForCwd(folder), name + ".jsonl"),
    status: "connected",
    messages: [],
    terminalExited: false,
    waitingForUser: false,
  });
  const first = session("first");
  const second = session("second");
  listener?.(first);
  listener?.(second);
  assert.equal(sounds, 0, "initial snapshots and busy updates must be silent");

  listener?.({ ...first, playCompletionSound: true });
  listener?.({ ...second, playCompletionSound: true });
  assert.equal(sounds, 2, "both sessions notify, without any selected-session state");
  listener?.(first);
  assert.equal(sounds, 2, "subsequent rendering updates must not repeat the sound");

  const other = session("other", path.resolve("workspace-b"));
  listener?.({ ...other, playCompletionSound: true });
  listener?.({ ...first, sessionFile: undefined, playCompletionSound: true });
  assert.equal(sounds, 2, "unrelated or unknown session folders must be silent");

  cwd = path.resolve("workspace-b");
  listener?.({ ...first, playCompletionSound: true });
  listener?.({ ...other, playCompletionSound: true });
  assert.equal(sounds, 3, "scope follows the current workspace folder");
  cwd = undefined;
  listener?.({ ...other, playCompletionSound: true });
  assert.equal(sounds, 3);
  subscription.dispose();
  assert.equal(listener, undefined);
});

test("Home and Settings include the same audio fallback as session detail", () => {
  const options = {
    assistantSoundEnabled: true,
    assistantSoundUri: "vscode-webview://qcode/chime.wav",
    cspSource: "vscode-webview://qcode",
  };
  const pages = [
    renderHome("nonce", path.resolve("nonexistent-workspace"), "test", undefined, new Map(), options),
    renderSettings("nonce", readQcodeSettings(""), "settings.json", "chime.wav", undefined, options),
    renderSessionDetail("", "nonce", { title: "Draft", messages: [] }, options),
  ];
  for (const html of pages) {
    assert.match(html, /event\.data\?\.command === 'playNotificationSoundFallback'/);
    assert.match(html, /connect-src vscode-webview:\/\/qcode/);
    assert.equal(html.split("const playNotificationSoundInWebview =").length, 2);
  }
});

test("shared audio fallback plays only on request and respects the disabled setting", async () => {
  for (const enabled of [true, false]) {
    const listeners = new Map<string, (event: unknown) => void>();
    let played = 0;
    class AudioContext {
      state = "running";
      destination = {};
      decodeAudioData() { return Promise.resolve({}); }
      createBufferSource() {
        return { connect() {}, start() { played += 1; } };
      }
      createGain() { return { gain: {}, connect() {} }; }
    }
    const script = renderNotificationSoundScript("nonce", {
      assistantSoundEnabled: enabled,
      assistantSoundUri: "chime.wav",
    }).replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    vm.runInNewContext(script, {
      window: {
        AudioContext,
        addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
      },
      fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    assert.equal(played, 0, "rendering a route must not play a sound");
    listeners.get("message")?.({ data: { command: "playNotificationSoundFallback" } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(played, enabled ? 1 : 0);
    listeners.get("message")?.({
      data: {
        command: "settingsSaved",
        notificationSoundOptions: { assistantSoundEnabled: !enabled, assistantSoundUri: "custom.wav" },
      },
    });
    listeners.get("message")?.({ data: { command: "playNotificationSoundFallback" } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(played, 1, "saved settings apply without navigating away from Settings");
  }
});
