import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import {
  messageRenderingScript,
  messageRenderingStyles,
} from "../webviews/messageRendering";
import { renderSessionDetail } from "../webviews/sessionDetail";

test("configures a nonce-bearing local Mermaid renderer in the session webview", () => {
  const html = renderSessionDetail("/tmp/session.jsonl", "fixed-nonce", {
    title: "Session",
    filePath: "/tmp/session.jsonl",
    messages: [],
  }, {
    mermaidScriptUri: "vscode-webview://qcode/media/vendor/mermaid.min.js",
    cspSource: "vscode-webview://qcode",
  });

  assert.match(
    html,
    /script-src 'nonce-fixed-nonce' vscode-webview:\/\/qcode;/,
  );
  assert.match(
    html,
    /scriptUri: "vscode-webview:\/\/qcode\/media\/vendor\/mermaid\.min\.js"/,
  );
  assert.match(html, /nonce: "fixed-nonce"/);
  assert.match(html, /script\.nonce = mermaidOptions\.nonce/);
  assert.doesNotMatch(html, /https?:\/\/.*mermaid/i);
});

test("renders Mermaid fences through the shared assistant Markdown path", () => {
  assert.match(messageRenderingScript, /fenceLanguage\.toLowerCase\(\) === 'mermaid'/);
  assert.match(messageRenderingScript, /class="code-block mermaid-block"/);
  assert.match(messageRenderingScript, /class="mermaid-source"/);
  assert.match(messageRenderingScript, /class="code-block-copy-button"/);
  assert.match(messageRenderingScript, /if \(isMarkdown\) renderMermaidDiagrams\(element\)/);
  assert.match(
    messageRenderingScript,
    /const isMarkdown = message\.kind !== 'thinking' && message\.role !== 'user'/,
  );
});

test("uses strict rendering and preserves source when Mermaid fails", () => {
  assert.match(messageRenderingScript, /startOnLoad: false/);
  assert.match(messageRenderingScript, /securityLevel: 'strict'/);
  assert.match(messageRenderingScript, /flowchart: \{ htmlLabels: false \}/);
  assert.match(messageRenderingScript, /mermaidRenderQueue\.then\(render, render\)/);
  assert.match(messageRenderingScript, /block\.isConnected/);
  assert.match(messageRenderingScript, /showMermaidFallback\(block\)/);
  assert.match(
    messageRenderingScript,
    /Unable to render Mermaid diagram\. Source is shown instead\./,
  );
  assert.match(
    messageRenderingStyles,
    /mermaid-block\[data-mermaid-state="rendered"\] \.mermaid-source[\s\S]*display: none/,
  );
});

test("package verification requires the generated Mermaid browser bundle", () => {
  const verificationScript = fs.readFileSync(
    path.resolve(__dirname, "../../scripts/verify-vsix.cjs"),
    "utf8",
  );
  assert.match(
    verificationScript,
    /extension\/media\/vendor\/mermaid\.min\.js/,
  );
});
