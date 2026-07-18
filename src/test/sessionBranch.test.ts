import * as assert from "node:assert/strict";
import { test } from "node:test";
import { selectActiveBranchLines } from "../sessionFiles";

const row = (value: unknown) => JSON.stringify(value);

test("selects only the active append branch", () => {
  const content = [
    row({ type: "session", version: 3, id: "session" }),
    row({ type: "message", id: "a", parentId: null, message: { role: "user", content: "root" } }),
    row({ type: "message", id: "b", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "old" }] } }),
    row({ type: "message", id: "c", parentId: "b", message: { role: "user", content: "abandoned" } }),
    row({ type: "branch_summary", id: "d", parentId: "a", fromId: "c", summary: "old branch" }),
    row({ type: "message", id: "e", parentId: "d", message: { role: "user", content: "active" } }),
  ].join("\n");
  const entries = selectActiveBranchLines(content).map((line) => JSON.parse(line));
  assert.deepEqual(entries.map((entry) => entry.id), ["session", "a", "d", "e"]);
});

test("keeps malformed rows out and preserves legacy linear files", () => {
  const content = `${row({ type: "session", version: 1 })}\nnot-json\n${row({ type: "message", message: { role: "user", content: "hi" } })}`;
  assert.equal(selectActiveBranchLines(content).length, 2);
});
