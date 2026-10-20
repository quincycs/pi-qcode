import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { serializeQcodeAttachmentPrompt } from "../chatAttachments";
import { readQcodeSettings, saveSlackShareThread, writeQcodeSettings } from "../qcodeSettings";
import { SlackShare } from "../slackShare";

function harness() {
  const settings = readQcodeSettings("");
  settings.slackShare = { enabled: true, userToken: "user-secret", botToken: "bot-secret", channelId: "C1" };
  const posts: { token: string; channel: string; text: string; thread?: string }[] = [];
  const uploads: { token: string; channel: string; thread: string; name: string }[] = [];
  const errors: string[] = [];
  let postError = "";
  let uploadError = "";
  let saveError = "";
  let wait: Promise<void> | undefined;
  const options = {
    readSettings: () => settings,
    saveThread: async (thread: typeof settings.slackShareThreads[number]) => {
      if (saveError) throw new Error(saveError);
      settings.slackShareThreads.push(thread);
    },
    showError: (message: string) => { errors.push(message); },
    api: {
      post: async (token: string, channel: string, text: string, thread?: string) => {
        posts.push({ token, channel, text, thread });
        await wait;
        if (postError) throw new Error(postError);
        return "123.456";
      },
      upload: async (token: string, channel: string, thread: string, attachment: { name: string }) => {
        uploads.push({ token, channel, thread, name: attachment.name });
        if (uploadError) throw new Error(uploadError);
      },
    },
  };
  const share = new SlackShare(options);
  return {
    share, options, settings, posts, uploads, errors,
    failPost: (reason: string) => { postError = reason; },
    failUpload: (reason: string) => { uploadError = reason; },
    failSave: (reason: string) => { saveError = reason; },
    pause: (promise: Promise<void>) => { wait = promise; },
  };
}

const file = path.resolve("session.jsonl");
const attachment = { id: "a", path: path.resolve("screenshot.png"), name: "screenshot.png" };

test("shares new user text/attachments, final replies and later users in order in one persistent thread", async () => {
  const h = harness();
  h.share.startSession(file, serializeQcodeAttachmentPrompt("hello", [attachment]), h.settings.slackShare);
  h.share.shareAssistant(file, "answer");
  h.share.shareUser(file, serializeQcodeAttachmentPrompt("", [attachment]));
  await h.share.whenIdle();
  assert.deepEqual(h.posts, [
    { token: "user-secret", channel: "C1", text: "qcode: hello", thread: undefined },
    { token: "bot-secret", channel: "C1", text: "answer", thread: "123.456" },
    { token: "user-secret", channel: "C1", text: "qcode: Attachments", thread: "123.456" },
  ]);
  assert.deepEqual(h.uploads, Array(2).fill({ token: "user-secret", channel: "C1", thread: "123.456", name: "screenshot.png" }));
  assert.deepEqual(h.settings.slackShareThreads, [{ sessionFile: file, channelId: "C1", threadTs: "123.456" }]);
  const resumed = new SlackShare(h.options);
  resumed.shareUser(file, "resumed");
  await resumed.whenIdle();
  assert.deepEqual(h.posts.at(-1), {
    token: "user-secret", channel: "C1", text: "qcode: resumed", thread: "123.456",
  });
  assert.deepEqual(h.errors, []);
});

test("prefixes attachment-only thread roots without changing uploads", async () => {
  const h = harness();
  h.share.startSession(file, serializeQcodeAttachmentPrompt("", [attachment]), h.settings.slackShare);
  await h.share.whenIdle();
  assert.deepEqual(h.posts, [
    { token: "user-secret", channel: "C1", text: "qcode: Attachments", thread: undefined },
  ]);
  assert.deepEqual(h.uploads, [
    { token: "user-secret", channel: "C1", thread: "123.456", name: "screenshot.png" },
  ]);
  assert.deepEqual(h.errors, []);
});

test("silently skips disabled, never-shared and changed-channel messages without backfill", async () => {
  const h = harness();
  h.share.shareUser(file, "never shared");
  h.share.shareAssistant(file, "historical");
  h.settings.slackShare.enabled = false;
  h.share.startSession(file, "disabled", h.settings.slackShare);
  h.settings.slackShare.enabled = true;
  h.share.shareUser(file, "enabled later, still never shared");
  await h.share.whenIdle();
  assert.equal(h.posts.length, 0);
  h.share.startSession(file, "root", h.settings.slackShare);
  await h.share.whenIdle();
  h.settings.slackShare = { ...h.settings.slackShare, channelId: "C2" };
  h.share.shareUser(file, "different channel");
  h.share.shareAssistant(file, "different channel answer");
  h.settings.slackShare = { ...h.settings.slackShare, channelId: "C1", enabled: false };
  h.share.shareUser(file, "disabled later");
  h.settings.slackShare = { ...h.settings.slackShare, enabled: true };
  h.share.shareUser(file, "future only");
  await h.share.whenIdle();
  assert.deepEqual(h.posts.map((post) => post.text), ["qcode: root", "qcode: future only"]);
  assert.deepEqual(h.errors, []);
});

test("initial creation failure disables that session, including after resume, without retry", async () => {
  const h = harness();
  h.failPost("channel_not_found");
  h.share.startSession(file, "root", h.settings.slackShare);
  h.share.shareAssistant(file, "queued reply");
  await h.share.whenIdle();
  h.failPost("");
  h.share.shareUser(file, "later");
  h.share.startSession(file, "do not retry root", h.settings.slackShare);
  await h.share.whenIdle();
  const resumed = new SlackShare(h.options);
  resumed.shareUser(file, "resume");
  await resumed.whenIdle();
  assert.equal(h.posts.length, 1);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /channel_not_found/);
});

test("persistence failure reports the reason but continues the established thread in memory", async () => {
  const h = harness();
  h.failSave("disk full");
  h.share.startSession(file, "root", h.settings.slackShare);
  h.share.shareAssistant(file, "queued reply");
  await h.share.whenIdle();
  h.share.shareUser(file, "later");
  await h.share.whenIdle();
  assert.equal(h.posts.length, 3);
  assert.equal(h.posts[1].thread, "123.456");
  assert.equal(h.posts[2].thread, "123.456");
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /resume sharing unavailable.*disk full/);
  const resumed = new SlackShare(h.options);
  resumed.shareUser(file, "cannot resume without a saved mapping");
  await resumed.whenIdle();
  assert.equal(h.posts.length, 3, "do not create another root or backfill after losing persistence");
});

test("later message and attachment failures report reasons, redact tokens, and do not disable the thread", async () => {
  const h = harness();
  h.failUpload("missing_scope user-secret bot-secret xoxb-other-token");
  h.share.startSession(file, serializeQcodeAttachmentPrompt("root", [attachment]), h.settings.slackShare);
  await h.share.whenIdle();
  h.failUpload("");
  h.failPost("ratelimited");
  h.share.shareAssistant(file, "failed reply");
  await h.share.whenIdle();
  h.failPost("");
  h.share.shareUser(file, "later user");
  h.share.shareAssistant(file, "later answer");
  await h.share.whenIdle();
  assert.deepEqual(h.posts.map((post) => post.text), ["qcode: root", "failed reply", "qcode: later user", "later answer"]);
  assert.equal(h.errors.length, 2);
  assert.match(h.errors[0], /attachment screenshot.png failed: missing_scope/);
  assert.doesNotMatch(h.errors.join(), /user-secret|bot-secret|xoxb-other-token/);
  assert.match(h.errors[1], /ratelimited/);
});

test("missing credentials report native-error callback reasons; missing bot does not disable later user sharing", async () => {
  const h = harness();
  h.settings.slackShare.botToken = "";
  h.share.startSession(file, "root", h.settings.slackShare);
  h.share.shareAssistant(file, "missing bot");
  h.share.shareUser(file, "user still works");
  await h.share.whenIdle();
  assert.equal(h.posts.length, 2);
  assert.match(h.errors[0], /Missing SLACK_BOT_TOKEN/);
});

test("Slack waits in the background and queued messages/attachments recheck enabled and channel", async () => {
  for (const change of ["disabled", "channel"] as const) {
    const h = harness();
    let release!: () => void;
    h.pause(new Promise<void>((resolve) => { release = resolve; }));
    assert.equal(h.share.startSession(file, serializeQcodeAttachmentPrompt("root", [attachment]), h.settings.slackShare), undefined);
    h.share.shareUser(file, "queued");
    await Promise.resolve(); // Root in flight; the rest must not be sent after the change.
    h.settings.slackShare = { ...h.settings.slackShare, ...(change === "disabled" ? { enabled: false } : { channelId: "C2" }) };
    release();
    await h.share.whenIdle();
    assert.equal(h.posts.length, 1);
    assert.equal(h.uploads.length, 0);
    assert.deepEqual(h.errors, []);
  }
});

test("settings normalize Slack fields and preserve concurrent thread saves across UI saves and reload", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-slack-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const settingsFile = path.join(directory, "settings.json");
  const settings = await writeQcodeSettings({ slackShare: {
    enabled: true, userToken: " user ", botToken: " bot ", channelId: " C1 ",
  } }, settingsFile);
  assert.deepEqual(settings.slackShare, { enabled: true, userToken: "user", botToken: "bot", channelId: "C1" });
  const thread = { sessionFile: file, channelId: "C1", threadTs: "123.456" };
  await Promise.all([
    saveSlackShareThread(thread, settingsFile),
    writeQcodeSettings({ slackShare: settings.slackShare, assistantSoundEnabled: true }, settingsFile),
    saveSlackShareThread({ ...thread, sessionFile: `${file}-2` }, settingsFile),
    // Pin/provider writers carry the full (possibly stale) settings object.
    writeQcodeSettings({ ...settings, assistantSoundEnabled: true }, settingsFile),
  ]);
  const loaded = readQcodeSettings(settingsFile);
  assert.equal(loaded.slackShareThreads.length, 2);
  assert.equal(loaded.assistantSoundEnabled, true);
  assert.deepEqual(loaded.slackShare, settings.slackShare);
  assert.deepEqual(readQcodeSettings("").slackShare, { enabled: false, userToken: "", botToken: "", channelId: "" });
  if (process.platform !== "win32") assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o600);
});
