import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import {
  dismissWhatsNewVersion,
  readQcodeSettings,
  writeQcodeSettings,
} from "../qcodeSettings";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reads and normalizes dismissed What's new versions from settings", () => {
  const filePath = temporarySettingsFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    dismissedWhatsNewVersions: ["1.2.2", " 1.2.3 ", "1.2.2", 17, ""],
  }));

  assert.deepEqual(readQcodeSettings(filePath).dismissedWhatsNewVersions, [
    "1.2.2",
    "1.2.3",
  ]);
});

test("persists a What's new dismissal in settings once", async () => {
  const filePath = temporarySettingsFile();

  await dismissWhatsNewVersion("1.2.3", filePath);
  await dismissWhatsNewVersion("1.2.3", filePath);

  assert.deepEqual(readQcodeSettings(filePath).dismissedWhatsNewVersions, [
    "1.2.3",
  ]);
});

test("settings UI writes preserve internal settings when omitted", async () => {
  const filePath = temporarySettingsFile();
  await dismissWhatsNewVersion("1.2.3", filePath);
  const storedSettings = JSON.parse(fs.readFileSync(filePath, "utf8"));
  storedSettings.folderSettings = [{
    path: "/workspace",
    pinned: [{ filePath: "/sessions/one.jsonl", pinnedAt: 42 }],
  }];
  fs.writeFileSync(filePath, JSON.stringify(storedSettings));

  await writeQcodeSettings({ assistantSoundEnabled: true }, filePath);

  const settings = readQcodeSettings(filePath);
  assert.equal(settings.assistantSoundEnabled, true);
  assert.deepEqual(settings.dismissedWhatsNewVersions, ["1.2.3"]);
  assert.deepEqual(settings.folderSettings, [{
    path: "/workspace",
    pinned: [{ filePath: "/sessions/one.jsonl", pinnedAt: 42 }],
  }]);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(filePath, "utf8")).folderSettings,
    storedSettings.folderSettings,
  );
});

function temporarySettingsFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-settings-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "nested", "settings.json");
}
