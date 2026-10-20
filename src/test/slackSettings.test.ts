import * as assert from "node:assert/strict";
import * as vm from "node:vm";
import { test } from "node:test";
import { readQcodeSettings, type QcodeSettings, type SlackShareSettings } from "../qcodeSettings";
import { renderSettings } from "../webviews/settings";

class Element {
  children: Element[] = [];
  value = "";
  checked = false;
  textContent = "";
  type = "";
  className = "";
  ariaLabel = "";
  title = "";
  focused = false;
  dataset = {};
  classList = { toggle() {} };
  listeners = new Map<string, () => void>();
  constructor(readonly tagName = "div") {}
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
  append(...elements: Element[]) { this.children.push(...elements); }
  replaceChildren() { this.children = []; }
  focus() { this.focused = true; }
  querySelector() { return this.find((element) => element.tagName === "input"); }
  find(predicate: (element: Element) => boolean): Element | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
    return undefined;
  }
  click() { this.listeners.get("click")!(); }
  change(value: string | boolean) {
    if (typeof value === "boolean") this.checked = value;
    else this.value = value;
    this.listeners.get(this.type === "checkbox" ? "change" : "input")!();
  }
}

const saved: SlackShareSettings = {
  enabled: true, userToken: "</script>user-secret", botToken: "bot-secret", channelId: "C1",
};

function harness(slackShare = saved) {
  const settings = { ...readQcodeSettings(""), slackShare };
  const html = renderSettings("nonce", settings, "settings.json", "sound.wav");
  const nodes = new Map<string, Element>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id)!;
  };
  const posted: { command: string; settings: QcodeSettings }[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  let discard = true;
  let confirmations = 0;
  const script = /<script nonce="nonce">([\s\S]*?)<\/script>/.exec(html)![1];
  vm.runInNewContext(script, {
    document: {
      getElementById: (id: string) => id === "whats-new-overlay" ? null : get(id),
      createElement: (tag: string) => new Element(tag),
    },
    window: { addEventListener: (_event: string, listener: typeof receive) => { receive = listener; } },
    acquireVsCodeApi: () => ({ postMessage: (message: typeof posted[number]) => posted.push(JSON.parse(JSON.stringify(message))) }),
    confirm: () => { confirmations += 1; return discard; },
  });
  const container = get("slack-share-options");
  return {
    html, get, container, posted,
    toggle: (enabled: boolean) => {
      get("slack-share-enabled").checked = enabled;
      get("slack-share-enabled").listeners.get("change")!();
    },
    input: () => container.find((element) => element.tagName === "input")!,
    edit: (label: string) => container.find((element) => element.ariaLabel === `Edit ${label}`)!.click(),
    button: (label: string) => container.find((element) => element.tagName === "button" && element.textContent === label)!,
    displays: () => container.children.map((row) => row.find((element) => element.className === "option-subtitle")?.textContent),
    acknowledge: (savedSettings = posted.at(-1)!.settings) => receive({ data: { command: "settingsSaved", settings: savedSettings } }),
    failSave: () => receive({ data: { command: "settingsSaveError", error: "Disk full" } }),
    setDiscard: (value: boolean) => { discard = value; },
    confirmations: () => confirmations,
  };
}

test("Slack Share displays an Enabled checkbox and three pencil rows with masked tokens below Command Options", () => {
  const h = harness();
  assert.ok(h.html.indexOf('id="command-options-title"') < h.html.indexOf('id="slack-share-title"'));
  assert.ok(h.html.indexOf('id="slack-share-title"') < h.html.indexOf('id="notification-options-title"'));
  assert.doesNotMatch(h.html, /<\/script>user-secret/);
  assert.match(h.html, /<label class="setting-toggle" for="slack-share-enabled">\s*<input type="checkbox" id="slack-share-enabled">/);
  assert.equal(h.get("slack-share-enabled").checked, true);
  assert.equal(h.container.children.length, 3);
  assert.deepEqual(h.displays(), ["••••••••", "••••••••", "C1"]);
  for (const [index, label] of ["SLACK_USER_TOKEN", "SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID"].entries()) {
    const row = h.container.children[index];
    assert.equal(row.find((element) => element.className === "option-title")?.textContent, label);
    assert.equal(row.find((element) => element.ariaLabel === `Edit ${label}`)?.textContent, "✎");
  }
  assert.equal(h.input(), undefined);
  assert.equal(h.button("Save"), undefined);
  assert.equal(h.button("Cancel"), undefined);
  assert.doesNotMatch(JSON.stringify(h.container), /user-secret|bot-secret/);
  assert.equal(h.posted.length, 0);
  const defaults = harness(readQcodeSettings("").slackShare);
  assert.equal(defaults.get("slack-share-enabled").checked, false);
  assert.deepEqual(defaults.displays(), ["Not set", "Not set", "Not set"]);
});

test("each Slack pencil edits only its field, saves explicitly, and returns to the confirmed saved display", () => {
  const cases: { key: keyof SlackShareSettings; label: string; type: string; value: string; display: string }[] = [
    { key: "userToken", label: "SLACK_USER_TOKEN", type: "password", value: "new-user", display: "••••••••" },
    { key: "botToken", label: "SLACK_BOT_TOKEN", type: "password", value: "new-bot", display: "••••••••" },
    { key: "channelId", label: "SLACK_CHANNEL_ID", type: "text", value: " C2 ", display: "C2" },
  ];
  for (const [index, field] of cases.entries()) {
    const h = harness();
    h.edit(field.label);
    const input = h.input();
    assert.equal(input.type, field.type);
    assert.equal(input.ariaLabel, field.label);
    assert.equal(input.focused, true);
    assert.equal(input.value, saved[field.key]);
    assert.equal(h.container.children.filter((row) => row.className === "option-card option-edit").length, 1);
    assert.ok(h.button("Save"));
    assert.ok(h.button("Cancel"));
    assert.equal(h.button("Delete"), undefined);
    input.change(field.value);
    assert.equal(h.posted.length, 0, "editing must not auto-save");
    assert.equal(h.get("status").textContent, "Unsaved changes");
    h.button("Save").click();
    assert.equal(h.posted.length, 1);
    const message = h.posted[0];
    assert.equal(message.command, "saveSettings");
    const expectedValue = field.value.trim();
    assert.deepEqual(message.settings.slackShare, { ...saved, [field.key]: expectedValue });
    assert.equal(message.settings.slackShareThreads, undefined, "UI must not overwrite thread state");
    h.acknowledge();
    assert.equal(h.input(), undefined);
    assert.equal(h.button("Save"), undefined);
    assert.equal(h.displays()[index], field.display);
    h.edit(field.label);
    assert.equal(h.input().value, expectedValue);
  }
});

test("Cancel discards text drafts without changing saved settings or sending a save", () => {
  for (const [label, value] of [
    ["SLACK_USER_TOKEN", "discarded-token"],
    ["SLACK_BOT_TOKEN", ""], ["SLACK_CHANNEL_ID", "discarded-channel"],
  ] as const) {
    const h = harness();
    h.edit(label);
    h.input().change(value);
    h.button("Cancel").click();
    assert.equal(h.posted.length, 0);
    assert.equal(h.input(), undefined);
    assert.deepEqual(h.displays(), ["••••••••", "••••••••", "C1"]);
    h.edit("SLACK_CHANNEL_ID");
    h.input().change("C2");
    h.button("Save").click();
    assert.deepEqual(h.posted[0].settings.slackShare, { ...saved, channelId: "C2" });
  }
});

test("failed saves retain the draft for correction but Cancel restores the previously saved value", () => {
  const h = harness();
  h.edit("SLACK_USER_TOKEN");
  h.input().change("unsaved-secret");
  h.button("Save").click();
  h.failSave();
  assert.equal(h.get("status").textContent, "Disk full");
  assert.equal(h.input().value, "unsaved-secret");
  h.button("Cancel").click();
  h.edit("SLACK_USER_TOKEN");
  assert.equal(h.input().value, saved.userToken);
  h.input().change("");
  h.button("Save").click();
  h.acknowledge();
  assert.equal(h.displays()[0], "Not set");
});

test("switching Slack fields or sections uses the existing discard confirmation and never persists drafts", () => {
  const h = harness();
  h.edit("SLACK_CHANNEL_ID");
  h.input().change("unsaved-channel");
  h.setDiscard(false);
  h.edit("SLACK_USER_TOKEN");
  assert.equal(h.input().ariaLabel, "SLACK_CHANNEL_ID");
  assert.equal(h.input().value, "unsaved-channel");
  h.setDiscard(true);
  h.edit("SLACK_USER_TOKEN");
  assert.equal(h.input().type, "password");
  assert.equal(h.displays()[2], "C1");
  h.input().change("discarded-token");
  h.get("add-environment-button").click();
  assert.equal(h.input(), undefined);
  assert.equal(h.displays()[0], "••••••••");
  assert.equal(h.confirmations(), 3);
  assert.equal(h.posted.length, 0);
  h.edit("SLACK_CHANNEL_ID");
  h.input().change("C2");
  h.button("Save").click();
  assert.deepEqual(h.posted[0].settings.slackShare, { ...saved, channelId: "C2" });
});

test("Enabled saves immediately in both directions without opening a pencil editor", () => {
  const h = harness();
  for (const enabled of [false, true]) {
    h.toggle(enabled);
    assert.equal(h.get("slack-share-enabled").checked, enabled);
    assert.equal(h.input(), undefined);
    assert.equal(h.button("Save"), undefined);
    assert.equal(h.button("Cancel"), undefined);
    const message = h.posted.at(-1)!;
    assert.equal(message.command, "saveSettings");
    assert.deepEqual(message.settings.slackShare, { ...saved, enabled });
    assert.equal(message.settings.slackShareThreads, undefined);
    h.acknowledge();
    assert.equal(h.get("slack-share-enabled").checked, enabled);
  }
  assert.equal(h.posted.length, 2);
  assert.equal(h.confirmations(), 0);
  h.edit("SLACK_CHANNEL_ID");
  h.input().change("C2");
  h.button("Save").click();
  assert.equal(h.posted.at(-1)!.settings.slackShare.enabled, true);
});

test("Enabled respects discard confirmation and never saves an unfinished token draft", () => {
  const h = harness();
  h.edit("SLACK_USER_TOKEN");
  h.input().change("discarded-token");
  h.setDiscard(false);
  h.toggle(false);
  assert.equal(h.get("slack-share-enabled").checked, true);
  assert.equal(h.input().value, "discarded-token");
  assert.equal(h.posted.length, 0);
  h.setDiscard(true);
  h.toggle(false);
  assert.equal(h.input(), undefined);
  assert.equal(h.get("slack-share-enabled").checked, false);
  assert.equal(h.confirmations(), 2);
  assert.deepEqual(h.posted[0].settings.slackShare, { ...saved, enabled: false });
  h.acknowledge();
  h.edit("SLACK_USER_TOKEN");
  assert.equal(h.input().value, saved.userToken);
  h.input().change("new-token");
  h.button("Save").click();
  assert.equal(h.posted.at(-1)!.settings.slackShare.enabled, false);
});

test("a failed Enabled save restores the saved checkbox state", () => {
  const h = harness();
  h.toggle(false);
  h.failSave();
  assert.equal(h.get("status").textContent, "Disk full");
  assert.equal(h.get("slack-share-enabled").checked, true);
  h.edit("SLACK_CHANNEL_ID");
  h.input().change("C2");
  h.button("Save").click();
  assert.equal(h.posted.at(-1)!.settings.slackShare.enabled, true);
});

test("confirmed settings, rather than a submitted draft, are the source of the display", () => {
  const h = harness();
  h.edit("SLACK_CHANNEL_ID");
  h.input().change("draft-channel");
  h.button("Save").click();
  h.acknowledge({ ...h.posted[0].settings, slackShare: { ...saved, channelId: "normalized-channel" } });
  assert.equal(h.displays()[2], "normalized-channel");
  h.edit("SLACK_CHANNEL_ID");
  assert.equal(h.input().value, "normalized-channel");
});
