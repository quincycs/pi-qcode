import * as assert from "node:assert/strict";
import { test } from "node:test";
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
  assert.match(html, /data\.command === 'playNotificationSoundFallback'/);
  assert.match(html, /playNotificationSoundInWebview\(\)/);
  assert.doesNotMatch(html, /playAssistantSound/);
  assert.doesNotMatch(html, /replaceWatchedMessages/);
});
