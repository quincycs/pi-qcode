import * as assert from "node:assert/strict";
import { test } from "node:test";
import { readSessionContextUsageFromContent } from "../sessionFiles";
import { renderSessionDetail } from "../webviews/sessionDetail";

const row = (value: unknown) => JSON.stringify(value);

test("preserves a known zero session cost", () => {
  const content = [
    row({ type: "session", version: 1 }),
    row({
      type: "message",
      message: {
        role: "assistant",
        provider: "local",
        model: "free-model",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 1,
          output: 1,
          totalTokens: 2,
          cost: { total: 0 },
        },
      },
    }),
  ].join("\n");

  assert.equal(readSessionContextUsageFromContent(content)?.sessionCost, 0);
});

test("renders persistent placeholders for context percentage and cost", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "New Session",
    messages: [],
  });

  assert.match(html, />—%<\/span><span class="context-usage-value">\$—<\/span>/);
  assert.match(html, /reportedPercent/);
  assert.match(html, /usage && usage\.percent/);
});
