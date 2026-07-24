import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_BYTES,
  normalizeSessionDraft,
  parseQcodeAttachmentBlock,
  sanitizeAttachmentFilename,
  savePastedAttachment,
  serializeQcodeAttachmentPrompt,
  validateChatAttachmentList,
  type ChatAttachment,
} from "../chatAttachments";
import { readSessionMessagesFromContent, userMessageMatchesRawText } from "../sessionFiles";
import { renderSessionMessage } from "../webviews/messageRendering";
import { renderSessionDetail } from "../webviews/sessionDetail";

function attachment(filePath: string, id = "attachment-1"): ChatAttachment {
  return {
    id,
    name: filePath.includes("\\") ? path.win32.basename(filePath) : path.basename(filePath),
    path: filePath,
    size: 1234,
  };
}

const footer = (paths: string[]) => [
  "<qcode-attachments>",
  "Attachments (local paths; use the read tool to inspect):",
  ...paths.map((filePath) => `- ${filePath}`),
  "</qcode-attachments>",
].join("\n");

test("serializes and parses text and attachment-only prompts", () => {
  const unix = attachment("/tmp/pi-qcode/id/screenshot one, 日本語.png");
  const windows = attachment("C:\\Users\\Name\\Temp\\pi-qcode\\id\\error log.txt", "attachment-2");
  const raw = serializeQcodeAttachmentPrompt("Explain this", [unix, windows]);

  assert.equal(raw, `Explain this\n\n${footer([unix.path, windows.path])}`);
  assert.deepEqual(
    parseQcodeAttachmentBlock(raw).attachments.map((item) => item.path),
    [unix.path, windows.path],
  );
  assert.equal(parseQcodeAttachmentBlock(raw).text, "Explain this");

  const attachmentOnly = serializeQcodeAttachmentPrompt("", [unix]);
  assert.equal(attachmentOnly, footer([unix.path]));
  assert.equal(parseQcodeAttachmentBlock(attachmentOnly).text, "");
});

test("only parses a complete final attachment block", () => {
  const complete = footer(["/tmp/pi-qcode/id/file.txt"]);
  assert.equal(parseQcodeAttachmentBlock(`${complete}\nmore text`).attachments.length, 0);
  assert.equal(parseQcodeAttachmentBlock(`prefix\n${complete}`).attachments.length, 0);
  assert.equal(parseQcodeAttachmentBlock(`prefix\n\n${complete}`).attachments.length, 1);
  assert.equal(parseQcodeAttachmentBlock(`${complete}\n`).attachments.length, 0);
});

test("sanitizes filenames against path and footer injection", () => {
  const name = sanitizeAttachmentFilename("../bad\\name\n- /injected?.png", "image/png");
  assert.equal(name, "injected-.png");
  assert.doesNotMatch(name, /[\r\n/\\?]/);
  assert.equal(sanitizeAttachmentFilename("image", "image/jpeg"), "pasted-image.jpg");
  assert.equal(sanitizeAttachmentFilename("", "application/pdf"), "pasted-file");
});

test("writes clipboard bytes beneath an injected temporary root", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qcode-attachment-test-"));
  try {
    const saved = await savePastedAttachment({
      name: "image",
      mimeType: "image/png",
      size: 4,
      data: `data:image/png;base64,${Buffer.from("test").toString("base64")}`,
    }, { root, id: "fixed-id" });

    assert.equal(saved.name, "pasted-image.png");
    assert.equal(saved.path, path.join(root, "fixed-id", "pasted-image.png"));
    assert.equal(await fs.promises.readFile(saved.path, "utf8"), "test");
    assert.equal("mimeType" in saved, false);
    assert.equal("kind" in saved, false);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("enforces attachment count, per-file, aggregate, and reported-size limits", async () => {
  const data = Buffer.from("x").toString("base64");
  await assert.rejects(
    savePastedAttachment({ data, size: MAX_CHAT_ATTACHMENT_BYTES + 1 }),
    /20 MiB.*path instead/,
  );
  await assert.rejects(
    savePastedAttachment({ data, size: 2 }),
    /does not match/,
  );

  const attachments = Array.from(
    { length: MAX_CHAT_ATTACHMENTS + 1 },
    (_, index) => attachment(
      path.join(os.tmpdir(), "pi-qcode", `id-${index}`, `file-${index}.txt`),
      `id-${index}`,
    ),
  );
  assert.throws(() => validateChatAttachmentList(attachments), /at most 8/);

  const oversizedTotal = attachments.slice(0, 3).map((item) => ({
    ...item,
    size: MAX_CHAT_ATTACHMENT_BYTES,
  }));
  assert.throws(() => validateChatAttachmentList(oversizedTotal), /50 MiB.*paths instead/);
});

test("loads legacy text drafts and metadata-only attachment drafts", () => {
  assert.deepEqual(normalizeSessionDraft("unfinished"), {
    text: "unfinished",
    attachments: [],
  });

  const validRootPath = path.join(os.tmpdir(), "pi-qcode", "id", "file.txt");
  const draft = normalizeSessionDraft({
    text: "with file",
    attachments: [{
      id: "id",
      name: "file.txt",
      path: validRootPath,
      size: 10,
      mimeType: "text/plain",
      kind: "file",
      data: "must-not-be-retained",
    }],
  });
  assert.equal(draft.attachments.length, 1);
  assert.equal("data" in draft.attachments[0], false);
  assert.equal("mimeType" in draft.attachments[0], false);
  assert.equal("kind" in draft.attachments[0], false);
});

test("parses attachment-only persisted user messages and matches raw optimistic prompts", () => {
  const filePath = "/tmp/pi-qcode/id/screenshot.png";
  const raw = footer([filePath]);
  const content = JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text: raw }] },
  });
  const message = readSessionMessagesFromContent(content).messages[0];

  assert.equal(message.text, "");
  assert.equal(message.attachments?.[0]?.path, filePath);
  assert.equal(userMessageMatchesRawText(message, raw), true);
});

test("skill presentation composes with attachment parsing", () => {
  const expanded = '<skill name="code-review" location="/tmp/SKILL.md">\n# Instructions\n</skill>';
  const raw = serializeQcodeAttachmentPrompt(expanded, [attachment("/tmp/pi-qcode/id/file.png")]);
  const content = JSON.stringify({
    type: "message",
    message: { role: "user", content: raw },
  });
  const message = readSessionMessagesFromContent(content).messages[0];
  assert.equal(message.text, "/skill:code-review");
  assert.deepEqual(message.activatedSkills, ["code-review"]);
  assert.equal(message.attachments?.length, 1);
});

test("renders generic attachment rows without image previews", () => {
  const message: Parameters<typeof renderSessionMessage>[0] = {
    role: "user",
    text: "",
    attachments: [attachment("/tmp/pi-qcode/id/screenshot.png")],
  };
  const staticHtml = renderSessionMessage(message);
  const detailHtml = renderSessionDetail("/tmp/session.jsonl", "nonce", {
    title: "Session",
    filePath: "/tmp/session.jsonl",
    messages: [message],
  }, { initialAttachments: message.attachments });

  assert.match(staticHtml, /attachment-row/);
  assert.match(staticHtml, /data-file-reference="\/tmp\/pi-qcode\/id\/screenshot\.png"/);
  assert.match(detailHtml, /composer-attachments/);
  assert.match(detailHtml, /closest\('\[data-file-reference\]'\)[\s\S]*command: 'openFileReference'/);
  assert.match(detailHtml, /addEventListener\('paste'/);
  assert.match(detailHtml, /clipboard\.files/);
  assert.doesNotMatch(staticHtml, /<img\b/i);
  assert.doesNotMatch(detailHtml, /<img\b|createObjectURL|background-image/i);
  assert.doesNotMatch(detailHtml, /img-src/);
});
