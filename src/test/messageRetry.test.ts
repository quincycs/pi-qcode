import * as assert from "node:assert/strict";
import { test } from "node:test";
import { renderSessionDetail } from "../webviews/sessionDetail";

test("renders failed optimistic messages without retry UI", () => {
  const html = renderSessionDetail("/tmp/session.jsonl", "nonce", {
    title: "Session",
    filePath: "/tmp/session.jsonl",
    messages: [{
      role: "user",
      kind: "message",
      text: "Keep this text visible",
      clientMessageId: "client-1",
      deliveryState: "failed",
    }],
  });

  assert.match(html, /class="session-message role-user"/);
  assert.match(html, /Keep this text visible/);
  assert.doesNotMatch(html, /retry-message/);
  assert.doesNotMatch(html, /delivery-failed/);
  assert.doesNotMatch(html, /textContent = 'Retry'/);
  assert.doesNotMatch(html, /clientMessageId: message\.clientMessageId/);
  assert.equal(html.match(/command: 'sendMessage'/g)?.length, 1);
});
