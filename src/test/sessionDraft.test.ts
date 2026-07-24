import * as assert from "node:assert/strict";
import { test } from "node:test";
import { renderSessionDetail } from "../webviews/sessionDetail";

test("pre-populates the session input with a safely serialized draft", () => {
  const html = renderSessionDetail("/tmp/session.jsonl", "nonce", {
    title: "Session",
    filePath: "/tmp/session.jsonl",
    messages: [],
  }, {
    initialInput: "unfinished\n<tag>",
  });

  assert.ok(html.includes('const initialInput = "unfinished\\n\\u003ctag>";'));
  assert.match(html, /if \(initialInput\) addToInput\(initialInput\)/);
});

test("saves the current draft when navigating home without a timer", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "New Session",
    messages: [],
  });

  assert.match(html, /command: 'home',[\s\S]*draftText: input\.value,[\s\S]*draftAttachments: getReadyAttachments\(\)/);
  assert.doesNotMatch(html, /command: 'saveDraft'/);
  assert.doesNotMatch(html, /draftSaveTimer|scheduleDraftSave/);
});

test("uses the assigned file for later navigation-based draft saves", () => {
  const html = renderSessionDetail("", "nonce", {
    title: "New Session",
    messages: [],
  });

  assert.match(
    html,
    /data\.command === 'sessionFileReady'[\s\S]*form\.dataset\.filePath = data\.filePath \|\| ''/,
  );
  assert.doesNotMatch(html, /previousFilePath|nextFilePath/);
});
