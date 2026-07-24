import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_CHAT_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS_TOTAL_BYTES = 50 * 1024 * 1024;
export const QCODE_ATTACHMENT_ROOT = path.join(os.tmpdir(), "pi-qcode");

const ATTACHMENT_TOO_LARGE_ERROR =
  "Each attachment must be 20 MiB or smaller. You can reference a larger file by its path instead.";
const ATTACHMENT_HEADER = "<qcode-attachments>\nAttachments (local paths; use the read tool to inspect):\n";
const ATTACHMENT_FOOTER = "</qcode-attachments>";

const clipboardMimeExtensions: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

export interface ChatAttachment {
  id: string;
  name: string;
  path: string;
  size?: number;
}

export interface SessionDraft {
  text: string;
  attachments: ChatAttachment[];
}

export interface SavePastedAttachmentRequest {
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
  data?: unknown;
}

export interface SavePastedAttachmentOptions {
  root?: string;
  id?: string;
}

export function getChatAttachmentRoot(): string {
  return QCODE_ATTACHMENT_ROOT;
}

export function sanitizeAttachmentFilename(
  value: string,
  mimeType = "",
): string {
  let name = path.win32.basename(path.posix.basename(String(value || "")))
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!name || name === "." || name === ".." || /^(image|file|blob)$/i.test(name)) {
    name = mimeType.toLowerCase().startsWith("image/")
      ? "pasted-image"
      : "pasted-file";
  }

  if (!path.extname(name)) {
    name += clipboardMimeExtensions[mimeType.toLowerCase()] || "";
  }

  // Keep room for filesystems whose component limit is 255 UTF-8 bytes.
  while (Buffer.byteLength(name, "utf8") > 240) name = name.slice(0, -1);
  return name || "pasted-file";
}

export async function savePastedAttachment(
  request: SavePastedAttachmentRequest,
  options: SavePastedAttachmentOptions = {},
): Promise<ChatAttachment> {
  const mimeType = typeof request.mimeType === "string"
    ? request.mimeType.trim().toLowerCase().slice(0, 255)
    : "";
  const reportedSize = request.size === undefined || request.size === null
    ? undefined
    : Number(request.size);
  if (reportedSize !== undefined && (!Number.isInteger(reportedSize) || reportedSize < 0)) {
    throw new Error("Attachment size is invalid.");
  }
  if (reportedSize !== undefined && reportedSize > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_ERROR);
  }
  if (typeof request.data !== "string") throw new Error("Attachment data is missing.");

  const encoded = request.data.replace(/^data:[^,]*;base64,/i, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error("Attachment data is not valid base64.");
  }
  if (encoded.length > Math.ceil(MAX_CHAT_ATTACHMENT_BYTES / 3) * 4 + 4) {
    throw new Error(ATTACHMENT_TOO_LARGE_ERROR);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_ERROR);
  }
  if (reportedSize !== undefined && bytes.length !== reportedSize) {
    throw new Error("Attachment size does not match the clipboard data.");
  }
  const id = options.id || crypto.randomUUID();
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("Attachment ID is invalid.");
  const name = sanitizeAttachmentFilename(
    typeof request.name === "string" ? request.name : "",
    mimeType,
  );
  const root = path.resolve(options.root || QCODE_ATTACHMENT_ROOT);
  const directory = path.join(root, id);
  const finalPath = path.join(directory, name);
  const partPath = path.join(directory, `${name}.${crypto.randomUUID()}.part`);

  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.promises.writeFile(partPath, bytes, { mode: 0o600, flag: "wx" });
    await fs.promises.rename(partPath, finalPath);
  } catch (error) {
    await fs.promises.rm(partPath, { force: true }).catch(() => {});
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    id,
    name,
    path: path.resolve(finalPath),
    size: bytes.length,
  };
}

export async function removePastedAttachment(
  attachment: ChatAttachment,
  root = QCODE_ATTACHMENT_ROOT,
): Promise<void> {
  if (!isAttachmentPathUnderRoot(attachment.path, root)) return;
  await fs.promises.rm(attachment.path, { force: true }).catch(() => {});
  await fs.promises.rmdir(path.dirname(attachment.path)).catch(() => {});
}

export function isAttachmentPathUnderRoot(
  filePath: string,
  root = QCODE_ATTACHMENT_ROOT,
): boolean {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function validateChatAttachment(
  value: unknown,
  root = QCODE_ATTACHMENT_ROOT,
): ChatAttachment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const filePath = typeof record.path === "string" ? record.path : "";
  if (!id || !/^[A-Za-z0-9-]+$/.test(id) || !isAttachmentPathUnderRoot(filePath, root)) return undefined;

  const name = sanitizeAttachmentFilename(
    typeof record.name === "string" ? record.name : basenameForAnyPlatform(filePath),
  );
  if (name !== basenameForAnyPlatform(filePath)) return undefined;
  const size = typeof record.size === "number" && Number.isInteger(record.size) && record.size >= 0
    ? record.size
    : undefined;
  if (size !== undefined && size > MAX_CHAT_ATTACHMENT_BYTES) return undefined;
  return {
    id,
    name,
    path: path.resolve(filePath),
    ...(size !== undefined ? { size } : {}),
  };
}

export function validateChatAttachmentList(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`A message can include at most ${MAX_CHAT_ATTACHMENTS} attachments.`);
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  return value.map((candidate) => {
    const attachment = validateChatAttachment(candidate);
    if (!attachment || seen.has(attachment.id)) {
      throw new Error("Submitted attachment metadata is invalid.");
    }
    seen.add(attachment.id);
    totalBytes += attachment.size || 0;
    if (totalBytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
      throw new Error(
        "Attachments in one message must total 50 MiB or less. You can reference additional files by their paths instead.",
      );
    }
    return attachment;
  });
}

export function serializeQcodeAttachmentPrompt(
  text: string,
  attachments: readonly ChatAttachment[],
): string {
  if (!attachments.length) return text;
  const paths = attachments.map((attachment) => {
    if (/\r|\n/.test(attachment.path)) throw new Error("Attachment path is invalid.");
    return `- ${attachment.path}`;
  });
  const block = `${ATTACHMENT_HEADER}${paths.join("\n")}\n${ATTACHMENT_FOOTER}`;
  return text ? `${text}\n\n${block}` : block;
}

export function parseQcodeAttachmentBlock(rawText: string): {
  text: string;
  attachments: ChatAttachment[];
} {
  const normalized = String(rawText || "").replace(/\r\n?/g, "\n");
  const blockPattern = /(?:^|\n\n)<qcode-attachments>\nAttachments \(local paths; use the read tool to inspect\):\n((?:- [^\n]+\n)+)<\/qcode-attachments>$/;
  const match = normalized.match(blockPattern);
  if (!match || match.index === undefined) return { text: normalized, attachments: [] };

  const paths = match[1]
    .trimEnd()
    .split("\n")
    .map((line) => line.slice(2));
  if (!paths.length || paths.some((filePath) => !isAbsoluteAnyPlatform(filePath) || /[\u0000-\u001f\u007f]/.test(filePath))) {
    return { text: normalized, attachments: [] };
  }

  return {
    text: normalized.slice(0, match.index),
    attachments: paths.map(attachmentFromPath),
  };
}

export function normalizeSessionDraft(value: unknown): SessionDraft {
  if (typeof value === "string") return { text: value, attachments: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { text: "", attachments: [] };
  const record = value as Record<string, unknown>;
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
        .map((attachment) => validateChatAttachment(attachment))
        .filter((attachment): attachment is ChatAttachment => Boolean(attachment))
        .slice(0, MAX_CHAT_ATTACHMENTS)
    : [];
  return {
    text: typeof record.text === "string" ? record.text : "",
    attachments,
  };
}

function attachmentFromPath(filePath: string): ChatAttachment {
  let size: number | undefined;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) size = stat.size;
  } catch {
    // Temporary files may already have been removed.
  }
  const name = basenameForAnyPlatform(filePath);
  return {
    id: createStableAttachmentId(filePath),
    name,
    path: filePath,
    ...(size !== undefined ? { size } : {}),
  };
}

function createStableAttachmentId(filePath: string): string {
  return `parsed-${crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 20)}`;
}

function basenameForAnyPlatform(filePath: string): string {
  return filePath.includes("\\") ? path.win32.basename(filePath) : path.posix.basename(filePath);
}

function isAbsoluteAnyPlatform(filePath: string): boolean {
  return path.posix.isAbsolute(filePath) || path.win32.isAbsolute(filePath);
}

