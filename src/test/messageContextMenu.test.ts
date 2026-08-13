import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  messageRenderingScript,
  messageRenderingStyles,
} from "../webviews/messageRendering";
import { renderSessionDetail } from "../webviews/sessionDetail";

test("offers Reply alongside Copy for highlighted session text", () => {
  assert.match(messageRenderingScript, /replyButton\.textContent = 'Reply'/);
  assert.match(
    messageRenderingScript,
    /showContextMenu\(vscode, 'Copy', selectedText, event\.clientX, event\.clientY, onReply\)/,
  );
  assert.match(messageRenderingScript, /if \(reply\) reply\(text\)/);
  assert.doesNotMatch(messageRenderingScript, /copyButton\.focus\(\)/);
});

test("appends highlighted text to the composer as a fenced reply", () => {
  const html = renderSessionDetail("/tmp/session.jsonl", "nonce", {
    title: "Session",
    filePath: "/tmp/session.jsonl",
    messages: [],
  });

  assert.match(
    html,
    /addToInput\('RE:' \+ lineBreak \+ codeFence \+ lineBreak \+ text \+ lineBreak \+ codeFence(?: \+ lineBreak)?\)/,
  );
  assert.match(
    html,
    /installClickHandlers\(vscode, \{ onReply: addReplyToInput \}\)/,
  );
});

test("keeps Reply hidden when the context menu is for a whole message", () => {
  assert.match(messageRenderingScript, /replyButton\.hidden = typeof onReply !== 'function'/);
  assert.match(messageRenderingStyles, /\.qcode-context-menu-button\[hidden\][^{]*\{\s*display: none !important;/);
  assert.match(
    messageRenderingScript,
    /showContextMenu\(vscode, 'Copy message', getRawMessageText\(messageElement\), event\.clientX, event\.clientY\)/,
  );
});
