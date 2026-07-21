import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  countMatchingUserMessages,
  getToolThinkingKey,
  normalizeUserMessageText,
  readSessionMessagesFromContent,
  userMessageTextsMatch,
} from "../sessionFiles";

const row = (value: unknown) => JSON.stringify(value);

const expandedSkill = (name: string) =>
  `<skill name="${name}" location="/tmp/${name}/SKILL.md">\n# Instructions\n</skill>`;

test("correlates a raw skill command with its expanded user message", () => {
  assert.equal(normalizeUserMessageText("/skill:code-review \n"), "/skill:code-review");
  assert.equal(
    userMessageTextsMatch("/skill:code-review ", expandedSkill("code-review")),
    true,
  );
  assert.equal(
    userMessageTextsMatch("/skill:code-review", "/skill:deep-plan"),
    false,
  );
  assert.equal(
    countMatchingUserMessages(
      [{ role: "user", kind: "message", text: expandedSkill("code-review") }],
      "/skill:code-review ",
    ),
    1,
    "an authoritative snapshot occurrence replaces the optimistic skill prompt",
  );
});

test("shows activated skills by name in the thinking summary", () => {
  const content = [
    row({ type: "session", version: 3, id: "session" }),
    row({
      type: "custom",
      id: "lifecycle",
      parentId: null,
      customType: "pi-lifecycle",
      data: { event: "session_start", state: "idle" },
    }),
    row({
      type: "custom",
      id: "start",
      parentId: "lifecycle",
      customType: "pi-lifecycle",
      data: { event: "agent_start", state: "busy", runId: "run" },
    }),
    row({
      type: "message",
      id: "user",
      parentId: "start",
      message: {
        role: "user",
        content: [{ type: "text", text: expandedSkill("code-review") }],
      },
    }),
    row({
      type: "message",
      id: "assistant",
      parentId: "user",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "read", skillName: "aa-standards" },
          { type: "toolCall", name: "bash", arguments: { command: "git status" } },
        ],
      },
    }),
  ].join("\n");

  const messages = readSessionMessagesFromContent(content).messages;
  assert.equal(messages.filter((message) => message.role === "user").length, 1);
  assert.equal(messages[0]?.text, "/skill:code-review");
  assert.deepEqual(messages[0]?.activatedSkills, ["code-review"]);
  assert.equal(
    messages.at(-1)?.text,
    "/skill:aa-standards\n/skill:code-review\nbash: 1",
  );
});

test("recognizes skill reads from live args and sanitized snapshots", () => {
  assert.equal(
    getToolThinkingKey("read", { path: "/tmp/deep-plan/SKILL.md" }),
    "/skill:deep-plan",
  );
  assert.equal(
    getToolThinkingKey("read", undefined, "code-review"),
    "/skill:code-review",
  );
  assert.equal(getToolThinkingKey("read", { path: "/tmp/README.md" }), "read");
});
