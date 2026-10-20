import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { WebClient, type WebClientOptions } from "@slack/web-api";
import { SlackWebApi } from "../slackWebApi";

function harness(fetch: NonNullable<WebClientOptions["fetch"]>) {
  const clients: { token: string; options: WebClientOptions }[] = [];
  const api = new SlackWebApi((token, options) => {
    clients.push({ token, options });
    // Exercise the real SDK, replacing only network I/O. No Slack credentials or CLI needed.
    return new WebClient(token, { ...options, fetch });
  });
  return { api, clients };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

test("SDK posts Markdown as the supplied user/bot identity with thread and no-retry options", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const h = harness(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return json({ ok: true, ts: "1.234" });
  });
  const text = "# Heading\n\n**Bold** and [link](https://example.com)\n\n```ts\nconst value = 1;\n```\nquotes ' \"\n$HOME";
  assert.equal(await h.api.post("user-secret", "C1", text), "1.234");
  const reply = "**Final reply** with `code`";
  await h.api.post("bot-secret", "C1", reply, "1.234");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
  assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer user-secret");
  assert.equal(new Headers(calls[1].init.headers).get("Authorization"), "Bearer bot-secret");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(calls[0].init.body))), {
    channel: "C1", markdown_text: text, unfurl_links: "false", unfurl_media: "false",
  });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(calls[1].init.body))), {
    channel: "C1", markdown_text: reply, thread_ts: "1.234", unfurl_links: "false", unfurl_media: "false",
  });
  for (const { options } of h.clients) {
    assert.deepEqual(options.retryConfig, { retries: 0 });
    assert.equal(options.rejectRateLimitedCalls, true);
    assert.equal(options.timeout, 30_000);
    assert.ok(options.logger, "SDK logging is suppressed; failures use redacted native error UI");
  }
  assert.ok(calls.every(({ init }) => init.signal instanceof AbortSignal));
});

test("SDK uploadV2 sends attachment bytes and completes in the same thread using the user token", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-slack-sdk-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "file.bin");
  const bytes = Buffer.from([0, 255, 1]);
  fs.writeFileSync(file, bytes);
  const calls: { url: string; init: RequestInit }[] = [];
  const uploadUrl = "https://files.slack.com/upload/test";
  const h = harness(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (String(url).endsWith("files.getUploadURLExternal")) {
      return json({ ok: true, upload_url: uploadUrl, file_id: "F1" });
    }
    if (String(url) === uploadUrl) return new Response("OK");
    return json({ ok: true, files: [{ id: "F1" }] });
  });
  await h.api.upload("user-secret", "C1", "1.234", { id: "a", name: "file.bin", path: file });
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://slack.com/api/files.getUploadURLExternal", uploadUrl,
    "https://slack.com/api/files.completeUploadExternal",
  ]);
  assert.ok(calls.every(({ init }) => new Headers(init.headers).get("Authorization") === "Bearer user-secret"));
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(calls[0].init.body))), { filename: "file.bin", length: "3" });
  assert.ok(calls[1].init.body instanceof FormData);
  const uploaded = calls[1].init.body.get("body");
  assert.ok(uploaded instanceof Blob);
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), bytes);
  const completed = new URLSearchParams(String(calls[2].init.body));
  assert.equal(completed.get("channel_id"), "C1");
  assert.equal(completed.get("thread_ts"), "1.234");
  assert.deepEqual(JSON.parse(completed.get("files")!), [{ id: "F1", title: "file.bin" }]);
  await assert.rejects(h.api.upload("user", "C1", "1.234", { id: "b", name: "missing", path: `${file}-missing` }), /ENOENT/);
  await assert.rejects(h.api.upload("user", "C1", "1.234", { id: "c", name: "directory", path: directory }), /not a file/);
  assert.equal(calls.length, 3);
});

test("SDK API, HTTP, rate-limit and network failures surface reasons without retries or rate-limit waits", { timeout: 5_000 }, async () => {
  const scenarios: { response: () => Response; reason: RegExp }[] = [
    { response: () => json({ ok: false, error: "missing_scope" }), reason: /missing_scope/ },
    { response: () => new Response("unavailable", { status: 503 }), reason: /503/ },
    { response: () => new Response("rate limited", { status: 429, headers: { "Retry-After": "60" } }), reason: /rate-limit/i },
    { response: () => { throw new Error("ECONNRESET"); }, reason: /ECONNRESET/ },
    { response: () => { throw new DOMException("Request timed out", "TimeoutError"); }, reason: /timed out/ },
    { response: () => new Response("not json"), reason: /not json/ },
    { response: () => json({ ok: true }), reason: /message timestamp/ },
  ];
  for (const { response, reason } of scenarios) {
    let calls = 0;
    const h = harness(async () => { calls += 1; return response(); });
    await assert.rejects(h.api.post("user", "C1", "hello"), reason);
    assert.equal(calls, 1);
  }
});

test("SDK never retries any stage of an attachment upload", { timeout: 5_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcode-slack-sdk-fail-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "file.bin");
  fs.writeFileSync(file, "attachment");
  for (const failedStage of [1, 2, 3]) {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      if (calls === failedStage) return new Response("rate limited", { status: 429, headers: { "Retry-After": "60" } });
      return calls === 1
        ? json({ ok: true, upload_url: "https://files.slack.com/upload/test", file_id: "F1" })
        : new Response("OK");
    });
    await assert.rejects(h.api.upload("user", "C1", "1.234", { id: "a", name: "file.bin", path: file }), /rate-limit/i);
    assert.equal(calls, failedStage);
  }
});
