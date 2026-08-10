import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { QcodeSettings } from "../qcodeSettings";
import { renderSettings } from "../webviews/settings";

const settings: QcodeSettings = {
  hashAutocompleteOptions: [],
  providerOptions: [],
  lastUsedProviderNickname: "",
  assistantSoundEnabled: false,
  assistantSoundPath: "",
  dismissedWhatsNewVersions: ["1.2.3"],
  folderSettings: [],
};

test("settings can manually open the current What's new dialog", () => {
  const html = renderSettings(
    "nonce",
    settings,
    "/tmp/settings.json",
    "/tmp/chime.wav",
    {
      version: "1.2.3",
      items: [{ title: "New feature", description: "Feature details" }],
    },
  );

  assert.match(html, /id="whats-new-button">What's new<\/button>/);
  assert.match(html, /id="whats-new-overlay"[^>]* hidden>/);
  assert.match(html, /New feature/);
  assert.match(html, /whatsNewOverlay\.hidden = false/);
});
