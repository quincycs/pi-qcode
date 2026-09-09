import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
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

test("renders persistent placeholders for model, context percentage and cost", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "New Session",
    messages: [],
  });

  assert.match(html, /<span class="context-usage-model">—<\/span><span class="context-usage-value">—%<\/span><span class="context-usage-value">\$—<\/span>/);
  assert.match(html, /reportedPercent/);
  assert.match(html, /usage && usage\.percent/);
});

test("displays the session model and reasoning before usage and updates them with live changes", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "Session",
    messages: [],
  });
  const script = html.slice(
    html.indexOf("const formatTokens ="),
    html.indexOf("const hideTypeahead ="),
  );
  let children: { textContent: string; title?: string }[] = [];
  const context = vm.createContext({
    document: { createElement: () => ({}) },
    contextUsage: {
      replaceChildren: (...elements: typeof children) => { children = elements; },
      setAttribute: () => {},
    },
  });
  vm.runInContext(script, context);
  vm.runInContext('updateContextUsage({ modelId: "model-one", percent: 25, sessionCost: 1.5 })', context);
  assert.deepEqual(children.map((element) => element.textContent), ["model-one", "25.0%", "$1.50"]);
  assert.equal(children[0].title, "model-one");

  vm.runInContext('updateContextUsage({ modelId: "model-one", thinkingLevel: "high", percent: 25, sessionCost: 1.5 })', context);
  assert.deepEqual(children.map((element) => element.textContent), ["model-one (high)", "25.0%", "$1.50"]);
  assert.equal(children[0].title, "model-one (high)");

  vm.runInContext('updateContextUsage({ modelId: "model-one", thinkingLevel: "off" })', context);
  assert.equal(children[0].textContent, "model-one (off)");

  vm.runInContext('updateContextUsage({ modelId: "model-two" })', context);
  assert.deepEqual(children.map((element) => element.textContent), ["model-two", "—%", "$—"]);

  vm.runInContext('updateContextUsage(undefined)', context);
  assert.deepEqual(children.map((element) => element.textContent), ["—", "—%", "$—"]);
});

test("colors context usage by used-token thresholds", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "New Session",
    messages: [],
  });

  assert.match(html, /getContextUsageColorClass = \(usedTokens\)/);
  assert.match(html, /usedTokens < 100000\) return ''/);
  assert.match(html, /usedTokens < 150000\) return ' context-usage-token-warning'/);
  assert.match(html, /return ' context-usage-token-danger'/);
  assert.match(html, /getContextUsageColorClass\(used\)/);
  assert.doesNotMatch(html, /getContextUsageColorClass\(rawPercent\)/);
});

test("starts and resets the live elapsed timer with the thinking block", () => {
  const html = renderSessionDetail("/tmp/session.jsonl", "nonce", {
    title: "Session",
    filePath: "/tmp/session.jsonl",
    messages: [
      { role: "assistant", kind: "message", text: "Previous" },
      { role: "thinking", kind: "thinking", text: "bash: 1" },
    ],
  });

  assert.match(html, /class="thinking-elapsed"/);
  assert.match(html, /Time elapsed while thinking/);
  assert.match(html, /window\.setInterval\(updateThinkingElapsed, 1000\)/);
  assert.match(html, /if \(thinkingStartedAt === undefined\) thinkingStartedAt = Date\.now\(\)/);
  assert.match(html, /resetThinkingElapsedIfChanged\(previousThinking, message\)/);
  assert.match(html, /resetThinkingElapsedIfChanged\(previousThinking, nextThinking\)/);
  assert.match(html, /hasThinkingInfoChanged\(previousMessage, nextMessage\)\) \{\s+thinkingStartedAt = Date\.now\(\)/);
  assert.doesNotMatch(html, /Time elapsed since the last assistant message/);
});

test("shows thinking immediately after submitting a message", () => {
  const html = renderSessionDetail("/tmp/session.jsonl", "nonce", {
    title: "Session",
    filePath: "/tmp/session.jsonl",
    messages: [],
  });

  assert.match(
    html,
    /appendMessage\(\{\s+role: 'user',[\s\S]*?appendMessage\(\{\s+role: 'thinking',\s+kind: 'thinking',\s+text: '',\s+counts: \{\},/,
  );
});

test("transitions the thinking block into a terminal user-input warning", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "New Session",
    messages: [{ role: "thinking", kind: "thinking", text: "bash: 1" }],
  }, {
    waitingForUser: true,
    waitingForUserMessage: "Approval is required.",
  });

  assert.match(html, /role-thinking\.role-waiting/);
  assert.match(html, /Waiting for you\.\.\./);
  assert.match(html, /if \(startedWaiting\) playNotificationSound\(\)/);
  assert.match(html, /Approval is required\./);
  assert.doesNotMatch(html, /id="user-input-wait"/);
});
