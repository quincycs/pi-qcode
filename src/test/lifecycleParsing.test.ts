import * as assert from "node:assert/strict";
import { test } from "node:test";
import { readSessionMessagesFromContent } from "../sessionFiles";

function line(value: unknown): string {
  return JSON.stringify(value);
}

test("duplicate lifecycle writers are idempotent and run-aware", () => {
  const entries = [
    { type: "session", version: 3, id: "session", cwd: "/tmp", timestamp: "2026-01-01T00:00:00Z" },
    { type: "custom", id: "1", parentId: null, customType: "pi-lifecycle", data: { event: "session_start", state: "idle" } },
    { type: "custom", id: "2", parentId: "1", customType: "pi-lifecycle", data: { event: "session_start", state: "idle" } },
    { type: "message", id: "3", parentId: "2", message: { role: "user", content: "hello" } },
    { type: "custom", id: "4", parentId: "3", customType: "pi-lifecycle", data: { event: "agent_start", state: "busy", runId: "run-a" } },
    { type: "custom", id: "5", parentId: "4", customType: "pi-lifecycle", data: { event: "agent_start", state: "busy", runId: "run-b" } },
    { type: "message", id: "6", parentId: "5", timestamp: "2026-01-01T00:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    { type: "custom", id: "7", parentId: "6", customType: "pi-lifecycle", data: { event: "agent_end", state: "idle", runId: "run-b" } },
    { type: "custom", id: "8", parentId: "7", customType: "pi-lifecycle", data: { event: "agent_end", state: "idle", runId: "run-a" } },
    { type: "custom", id: "9", parentId: "8", customType: "pi-lifecycle", data: { event: "agent_end", state: "idle", runId: "run-a" } },
  ];

  const result = readSessionMessagesFromContent(entries.map(line).join("\n"));
  assert.deepEqual(result.messages.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "hello" },
    { role: "assistant", text: "done" },
  ]);
  assert.equal(result.messages[1]?.timestamp, Date.parse("2026-01-01T00:00:05Z"));
  assert.deepEqual(result.warnings, []);
});
