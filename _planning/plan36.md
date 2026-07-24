# Plan 36: Paste Chat Attachments Through the System Temporary Directory

## Goal

Allow users to paste an image or another file into the qcode chat composer, show every pasted item as a compact file attachment rather than a thumbnail, and make the file available to Pi through an absolute path in the submitted prompt.

Use the operating system's temporary directory as the only file integration layer. After qcode has written the clipboard payload to disk, qcode, the terminal session manager, and the Pi bridge continue transporting an ordinary text prompt. Do not add binary attachment fields to the bridge protocol or call Pi's image-content API.

## Finalized Product Behavior

1. Pasting ordinary text continues to use the textarea's native paste behavior.
2. Pasting an image or file creates an attachment row above the textarea.
3. Images use the same generic file presentation as all other files. Do not render thumbnails or image previews.
4. Each attachment row shows a file icon, filename, type/extension, size, and remove button.
5. qcode writes each pasted item under a qcode subdirectory of `os.tmpdir()` and retains its absolute path in composer state.
6. The user may submit text with attachments or attachments without text.
7. On submit, the extension appends a generated attachment block containing one absolute path per line to the bottom of the real prompt sent to Pi.
8. The visible user message shows the original user text and file rows, not the generated attachment block.
9. Pi receives only text containing local paths. The agent can use its existing `read` tool to inspect images and readable files, or other tools where appropriate for an arbitrary format.
10. The operating system owns eventual cleanup of the temporary files. Do not add qcode cache settings, a cache-management UI, age-based cleanup, or attachment-specific missing-file handling.
11. Plan 35 removes qcode's failed-message Retry UI. Do not introduce attachment retry behavior as part of this work.

## Architectural Decision

### Use the system temporary directory

Use Node's portable temporary-directory API:

```ts
import * as os from "node:os";
import * as path from "node:path";

const attachmentRoot = path.join(os.tmpdir(), "pi-qcode");
```

This works across supported platforms, including Windows, where `os.tmpdir()` normally resolves beneath the current user's `%TEMP%` directory.

Write each attachment beneath an unpredictable per-attachment directory:

```text
<os.tmpdir()>/pi-qcode/<random UUID>/<sanitized filename>
```

Examples:

```text
/var/folders/.../T/pi-qcode/7f.../pasted-image.png
/tmp/pi-qcode/7f.../error.log
C:\Users\name\AppData\Local\Temp\pi-qcode\7f...\requirements.pdf
```

Use absolute paths in prompts so Pi can find the files regardless of its current working directory.

### Accept the one unavoidable binary handoff

A screenshot on the browser clipboard normally has bytes but no filesystem path, and the webview cannot write directly to the local filesystem. Therefore the clipboard payload must cross the webview-to-extension message boundary once. The extension writes it immediately to the system temporary directory. After that point, only attachment metadata and paths are transported.

Do not send file bytes:

- through `src/piTerminalSessions.ts`;
- through `src/piBridgeProtocol.ts`;
- over the loopback bridge socket;
- directly to `pi.sendUserMessage()` as image content;
- in session draft storage;
- in rendered HTML or later webview state updates.

### Keep the bridge protocol unchanged

`send_user_message` remains a text-only command. No protocol-version bump is required. Existing first-message terminal startup and subsequent bridge delivery continue to work because the attachment block is ordinary text.

## Prompt Format

Append a deliberately recognizable block to the bottom of the submitted text:

```text
Please explain the error shown here.

<qcode-attachments>
Attachments (local paths; use the read tool to inspect):
- /absolute/path/pasted-image.png
- /absolute/path/error.log
</qcode-attachments>
```

On Windows, keep normal absolute paths with backslashes:

```text
<qcode-attachments>
Attachments (local paths; use the read tool to inspect):
- C:\Users\name\AppData\Local\Temp\pi-qcode\...\pasted-image.png
</qcode-attachments>
```

Rules:

1. Put one path on each line; do not comma-separate paths.
2. Generate the block in the extension host from validated attachment records. Do not accept a prebuilt block or authoritative path list from arbitrary webview text.
3. Insert one blank line between non-empty user text and the block.
4. For an attachment-only submission, the block itself is the entire prompt.
5. Parse only a complete, final `<qcode-attachments>` block generated at the end of a message. Text a user happens to write elsewhere must not be interpreted as attachment metadata.
6. Sanitize filenames to remove line breaks, control characters, path separators, and platform-invalid characters. Generated attachment paths therefore cannot inject extra footer lines.
7. Preserve the generated block in the raw prompt persisted by Pi, but remove it from qcode's visible message text.

Create shared extension-host helpers for serializing and parsing this format rather than duplicating regular expressions across session parsing and terminal reconciliation.

## Data Model

Add a safe UI/session representation, for example in `src/chatAttachments.ts` or `src/sessionFiles.ts`:

```ts
export interface ChatAttachment {
  id: string;
  name: string;
  path: string;
  size?: number;
}
```

Extend `SessionMessage`:

```ts
export interface SessionMessage {
  // Existing fields remain.
  attachments?: ChatAttachment[];
}
```

The attachment path is intentionally part of the session-facing metadata because it is the integration contract with Pi and is needed to reconstruct file cards from persisted prompts. Never include attachment bytes.

Draft storage should evolve from a bare string to a backward-compatible object:

```ts
interface SessionDraft {
  text: string;
  attachments: ChatAttachment[];
}
```

Continue accepting existing string values from `workspaceState` as text-only drafts. Persist only metadata and temporary paths.

## Phase 1: Add Temporary Attachment Storage

Create `src/chatAttachments.ts` with focused filesystem and prompt-format responsibilities.

### Saving pasted data

Add webview messages such as:

```ts
{ command: "savePastedAttachment", requestId, name, mimeType, size, data }
{ command: "removePastedAttachment", attachment }
```

And extension-to-webview responses:

```ts
{ command: "pastedAttachmentSaved", requestId, attachment }
{ command: "pastedAttachmentSaveError", requestId, error }
```

The initial implementation may use a base64 payload because it is straightforward and JSON-safe. Strip any data-URL prefix before decoding and do not retain the encoded value after the write completes. If practical with the VS Code 1.92 webview API, a typed byte array is also acceptable, but do not broaden the first implementation into a bridge-level binary protocol.

On the extension side:

1. Validate the request shape.
2. Enforce a maximum of 20 MiB per attachment while saving.
3. Enforce a maximum of 8 attachments and 50 MiB total in the composer and when validating draft/submission metadata.
4. Confirm the decoded byte length agrees with the reported size when a size is provided.
5. Normalize the clipboard filename. Use `pasted-image` for a detected image MIME type and `pasted-file` otherwise, adding a known safe extension when available.
6. Infer a safe extension from a known image MIME type when a pasted screenshot has no useful extension.
7. Create `<os.tmpdir()>/pi-qcode/<UUID>/` recursively.
8. Write to a temporary `.part` file with user-only permissions where supported, then rename atomically to the final name.
9. Return the attachment metadata and absolute final path.
10. On removal before submission, best-effort delete the file and its now-empty UUID directory.

Do not sweep old completed attachments on activation or delete sent files on webview close/deactivation. Pi may still be processing the prompt. Let the OS manage eventual cleanup.

## Phase 2: Add Paste Handling and File-Only Composer UI

Update `src/webviews/sessionDetail.ts`.

### Paste handling

Listen for `paste` on the textarea and inspect `event.clipboardData.items` and `event.clipboardData.files`.

- If there are no file items, do nothing and allow native text paste.
- If file items exist, prevent the browser's default paste behavior and attach those files.
- Do not also insert accompanying HTML or fallback image URLs when a file payload is present.
- Support multiple files from one paste.
- Read each `File` only long enough to post it to the extension.
- Correlate save responses using request IDs.

Maintain attachment states such as `saving`, `ready`, and `error`. Disable submission while any attachment is still saving. An errored row should show a concise error and allow removal; no thumbnail is needed for any state.

### Composer rendering

Refactor the footer into a vertical composer container with:

1. An attachment list, hidden when empty.
2. The existing textarea and submit button in a horizontal input row.
3. The existing typeahead positioned relative to the composer without being obscured by attachment rows.

Each attachment row should include:

- a generic file glyph or inline SVG;
- escaped filename;
- secondary text such as `PNG · 1.2 MB` or `PDF · 340 KB`;
- a remove button with an accessible label;
- no `<img>`, canvas, object URL, data URL, or image background.

Do not add `img-src` to the webview CSP.

Allow submit when:

```text
input contains text OR at least one attachment is ready
```

After submit, clear both the textarea and composer attachment list. Do not delete submitted temporary files.

For maintainability, attachment styles and reusable rendering script may be extracted into `src/webviews/attachmentRendering.ts`, following the existing `messageRendering.ts` pattern.

## Phase 3: Append Paths at the Extension Boundary

Extend the `sendMessage` webview command in `src/extension.ts` to carry the original text plus ready attachment metadata. The extension host must:

1. Revalidate attachment metadata directly without maintaining a separate extension-side attachment registry.
2. Confirm every submitted path resolves beneath `path.join(os.tmpdir(), "pi-qcode")`.
3. Build the raw wire prompt by appending the canonical attachment block.
4. Pass that raw string to `terminalSessions.sendSessionMessage()` exactly as it passes text today.
5. Clear the corresponding draft after submission.

This keeps path generation and trust decisions outside the webview while leaving `PiTerminalSessions`, shell quoting, the text-only bridge protocol, and `pi.sendUserMessage()` unchanged.

The existing new-session path can continue passing the raw prompt as the positional terminal argument. The existing quoting code already handles multiline prompt text and platform-specific shells; add focused tests for attachment blocks containing Windows paths and filenames with spaces.

## Phase 4: Parse Attachments for Visible Session Messages

Update `src/sessionFiles.ts` so all user-message paths use the same parser:

```ts
parseQcodeAttachmentBlock(rawText) -> {
  text: string;
  attachments: ChatAttachment[];
}
```

Apply it when:

- reading inactive session JSONL;
- building bridge-connected snapshots;
- handling bridge `user_input` events;
- creating and reconciling optimistic user messages;
- normalizing text for duplicate/occurrence matching;
- deriving recent-session titles and previews.

Important details:

1. `SessionMessage.text` should contain only the user's visible text.
2. `SessionMessage.attachments` should contain parsed file records.
3. An attachment-only user message remains renderable even when its visible text is empty.
4. Matching and optimistic reconciliation must compare canonical visible text plus attachment paths, or otherwise normalize both raw and visible forms consistently. Do not let the bridge's authoritative raw prompt duplicate the optimistic message merely because it contains the generated footer.
5. For persisted prompts, derive `name` and display type from the path extension, and best-effort read the current size with `stat`. A missing path may simply omit the size; do not add special missing-file warnings or retry behavior.
6. A recent-session preview for an attachment-only first message should use a compact value such as `Attached: screenshot.png`, not the internal attachment block.
7. Skill expansion and attachment stripping must compose correctly. Preserve existing `/skill:` presentation and matching behavior when a skill submission also has attachments.

The bridge truncates sanitized text content at 192 KiB. Reject the complete serialized prompt when it exceeds that limit rather than truncating visible text while preserving the attachment block. The bridge event remains text-only.

## Phase 5: Render Attachments on Sent Messages

Update both static and dynamic message rendering:

- `renderSessionMessage()` in `src/webviews/messageRendering.ts` for initial HTML;
- `renderMessageElement()` in `src/webviews/sessionDetail.ts` for optimistic and live messages.

Render the same compact file-row visual used by the composer. Do not render thumbnails for historical images.

Attachment rows in sent messages may be clickable using the existing `openFileReference` command and absolute path. Use `textContent`/`escapeHtml` and data attributes safely. If the OS has already removed a temporary file, rely on the existing file-open/read error behavior; do not introduce an attachment-specific warning state.

The message context-menu copy operation should copy the visible user text. It may append a simple attachment path list to the copied text, but it must not expose internal qcode delimiters. Pick one behavior and cover it with a rendering test.

Plan 35 removes the visible failed-delivery Retry button. Do not add attachment resend controls or retain binary payloads for retry.

## Draft and Navigation Behavior

Preserve qcode's current draft behavior when navigating home:

1. Include attachment metadata in the `home` message alongside `draftText`.
2. Store it under the same new-session/session-specific draft key.
3. Restore file rows when returning to the draft.
4. Removing a restored unsent attachment best-effort deletes its temporary file.
5. Submitting clears the stored text and attachment metadata.

Do not copy attachment data into `workspaceState`. If the operating system eventually removes a restored temporary path, qcode can still show the path card and normal tool/file errors can report its absence when used.

## Files to Change

### New

- `src/chatAttachments.ts`
- Focused tests such as `src/test/chatAttachments.test.ts`

### Existing

- `src/extension.ts`
- `src/sessionFiles.ts`
- `src/piTerminalSessions.ts` only where optimistic message normalization needs structured attachments
- `src/webviews/sessionDetail.ts`
- `src/webviews/messageRendering.ts`
- `src/test/sessionDraft.test.ts`
- Session parsing/rendering tests
- `pi-extensions/qcode-bridge.ts` only to preserve the trailing attachment block during safe text truncation

### Explicitly unchanged

- `src/piBridgeProtocol.ts` command schema and protocol version
- Pi's native image-content API usage
- `package.json` settings contributions
- Settings webview
- Any cache-clear command or UI

## Automated Tests

Add tests for:

1. Serializing text plus one or more attachment paths.
2. Attachment-only prompt serialization.
3. Parsing and stripping only a complete final qcode attachment block.
4. Unix and Windows absolute paths, spaces, commas, Unicode, and backslashes.
5. Filename sanitization preventing newline/path injection.
6. File-size, attachment-count, and aggregate-size limits.
7. Writing beneath an injected temporary root in tests rather than the real system temp directory.
8. Backward-compatible loading of string-only drafts.
9. Saving/restoring draft attachment metadata without bytes.
10. Rendering composer and message file rows with no `<img>` elements or thumbnail CSS.
11. Ordinary text/HTML paste remaining ordinary text when no clipboard file exists.
12. Multiple pasted files and attachment removal.
13. Attachment-only user messages remaining visible after persisted-session parsing.
14. Optimistic-to-authoritative reconciliation with the generated footer and no duplicate user message.
15. Recent-session previews excluding the internal attachment block.
16. Skill messages with attachments preserving skill presentation.
17. Oversized serialized prompts being rejected before bridge snapshot sanitization can truncate attachment paths.
18. Existing text-only send behavior remaining unchanged.

Run:

```bash
npm test
npm run package
```

The package verification should confirm the new source compiles into `dist` and no temporary attachment data is included in the VSIX.

## Manual Verification Matrix

### Paste sources

- Screenshot copied to the clipboard.
- PNG/JPEG copied as a file from Finder, Windows Explorer, and a Linux file manager where available.
- Text file.
- PDF or other binary file.
- Multiple files in one paste.
- Ordinary text.
- Rich text/HTML with no file payload.

### Session paths

- First message in a new session.
- Message in an already connected session.
- Message queued while Pi is busy.
- Navigate home and return to an unsent attachment draft.
- Reopen an inactive persisted session and confirm file cards reconstruct from prompt paths.

### Presentation

- Composer and sent messages show file cards only.
- Images never display thumbnails.
- Attachment paths do not appear as raw generated footer text in qcode.
- Pi receives the attachment block at the bottom of the prompt.
- Pi can call `read` on a pasted image path and receive the image through its normal tool behavior.
- Windows paths with spaces are passed as one intact path line.

## Accepted Limitations

- The temporary path is ephemeral. The operating system may remove it after a reboot, cleanup cycle, or long delay.
- qcode does not guarantee that old attachment paths remain valid indefinitely.
- qcode does not provide cache controls because it does not own long-term retention.
- The model does not receive pasted image bytes automatically. It must use the `read` tool on the supplied path.
- Arbitrary file usefulness depends on the tools available to Pi; a path does not make every binary format directly understandable.
- The clipboard bytes cross the webview boundary once so the extension can create the temporary file.
- No attachment-specific retry, missing-file warning, drag-and-drop, file-picker button, or thumbnail preview is included in this implementation.
