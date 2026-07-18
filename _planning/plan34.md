# Plan 34: Replace the Ad Hoc Pi Integration with a Terminal-Preserving Qcode Bridge

## Goal

Preserve the key pi-qcode product benefit: **Pi remains an interactive process in a visible VS Code terminal, and the user can move from the quiet qcode UI to the complete Pi TUI immediately.**

At the same time, replace the current indirect integration—`pi-msg` sockets, the separately installed `pi-lifecycle` extension as the live run-boundary channel, session-file polling, and live JSONL reconstruction—with a bundled, qcode-specific Pi extension that exposes structured session events, accepts user messages through Pi's supported extension API, and continues writing compatible `pi-lifecycle` JSONL markers for durable rendering metadata.

The implementation must keep the terminal's Pi process as the only owner and writer of the active session. Do not embed `AgentSession`, use Pi SDK session ownership, or run a second RPC/SDK agent against the same session.

## Desired End State

1. qcode starts Pi in a normal visible VS Code terminal.
2. The command includes qcode's bundled Pi extension with `pi -e <qcode-bridge-path>`.
3. Pi runs its normal interactive TUI with all of the user's settings, models, skills, extensions, and commands.
4. The bundled bridge publishes structured lifecycle, message, tool, model, thinking-level, context-usage, and session events to qcode.
5. qcode sends subsequent user messages to the bridge, which calls `pi.sendUserMessage()`.
6. The bridge uses `followUp` delivery while Pi is busy, preserving the current non-interrupting behavior. Steering can be added later as an explicit UI action.
7. Session JSONL remains Pi's persistence format and qcode's fallback for inactive sessions, but it is no longer the live event bus for bridge-connected sessions.
8. Users no longer need to install `pi-msg` or `pi-lifecycle` for qcode; the bundled bridge itself writes the compatible lifecycle markers qcode needs.
9. Clicking the active terminal continues to expose the complete, live Pi experience immediately.
10. A message submitted in qcode appears immediately and remains visible while the terminal starts, the bridge connects, the session file is attached, and authoritative Pi events catch up.
11. Bridge and terminal connection state is tracked internally and is not rendered as status text, badges, banners, or other connection chrome in the qcode UI.

## Architectural Decision

### Keep

- A real interactive Pi process in a VS Code terminal.
- One terminal and one Pi process per active qcode session.
- Pi as the authoritative session owner.
- Existing webview screens and the quiet presentation of user messages, summarized activity, and final assistant messages.
- JSONL discovery for the home screen and inactive-session fallback rendering.
- Durable `pi-lifecycle` custom entries as run-boundary metadata for ideal persisted-session rendering.

### Replace

- `pi-msg` as qcode's command channel.
- The separately installed `pi-lifecycle` package and JSONL watching as qcode's live run-boundary channel. The bundled bridge takes over marker creation while bridge events drive the connected UI.
- Polling the session directory to discover the file created by a new Pi process.
- Watching JSONL as the primary source of live active-session events.
- Spawning `pi --list-models` for context information while a bridge is connected.

### Do Not Introduce

- `@earendil-works/pi-coding-agent` as a runtime dependency of the VS Code extension.
- A headless RPC process as the active agent owner.
- Concurrent Pi processes writing to the same session.
- A bridge tool, prompt, or system-message injection visible to the model. The bridge is transport-only and must not alter the model's context or available tools. Its `appendEntry()` lifecycle markers are custom entries and therefore do not participate in LLM context.
- User-visible terminal/bridge connection indicators. Connection state is operational state for routing, retry, and diagnostics only.

## Phase 1: Define a Versioned Bridge Protocol

Add a shared protocol module, for example `src/piBridgeProtocol.ts`, containing JSON-serializable message types and runtime validators.

Use LF-delimited JSON records over a loopback TCP connection. Parsing must:

- Decode UTF-8 safely across arbitrary network chunks.
- Split only on `\n`.
- Strip one trailing `\r` when present.
- Reject malformed JSON without crashing either process.
- Enforce a maximum record size.
- Reject unknown protocol versions with an actionable error.

Define at least these bridge-to-qcode events:

- `hello`
  - protocol version
  - bridge ID
  - Pi process ID
  - cwd
  - session ID and session file when available
  - session name
  - idle/busy state
  - current model, model context window, and thinking level
  - current context usage
- `session_state`
  - emitted whenever the session file, session ID, name, model, thinking level, leaf, or context usage changes
- `session_snapshot`
  - active-branch session entries or a normalized active-branch message snapshot
  - stable session entry IDs for persisted messages
  - current leaf ID and the bridge event sequence covered by the snapshot
  - used on initial connection and after tree/session navigation
- `user_input`
  - raw user text and source from Pi's `input` event
  - optional qcode client-message ID when correlated with a qcode submission
- `agent_start`
- `agent_settled`
- `message_start`
- `message_update` only if qcode later needs streaming text; do not require it for the first migration
- `message_end`
- `tool_execution_start`
- `tool_execution_update` only if needed for current activity rendering
- `tool_execution_end`
- `session_shutdown`
- `bridge_error`
- command acknowledgements correlated by request ID

Define at least these qcode-to-bridge commands:

- `authenticate`
- `send_user_message`
  - request ID
  - stable client-message ID generated before the webview renders the optimistic message
  - text
  - delivery preference, initially `followUp` when busy
- `request_snapshot`
- `ping`

Every bridge event must carry a monotonic per-bridge-instance sequence number. Command handling must be idempotent for a bounded cache of recently accepted request/client-message IDs so a timeout or reconnect cannot submit the same user message twice.

Do not forward credentials, system prompts, complete environment variables, or unnecessary tool output. Sanitize snapshots so image base64 data and unbounded tool results are not copied into the bridge protocol.

## Phase 2: Add the Bundled Pi Bridge Extension

Create a standalone Pi extension, for example:

- `pi-extensions/qcode-bridge.ts`

The file must be included in the VSIX and loaded explicitly for every qcode-created Pi process:

```text
pi -e <absolute-path-to-qcode-bridge.ts> ...
```

Keep runtime imports limited to Node built-ins. A type-only import from `@earendil-works/pi-coding-agent` is acceptable because Pi/Jiti removes it at runtime. Do not add the Pi SDK to qcode's package dependencies.

### Bridge startup and discovery

On `session_start`, not in the extension factory:

1. Read bridge ID, authentication token, and registration-file path from environment variables supplied by qcode.
2. Start a TCP server bound only to `127.0.0.1` on an OS-assigned port.
3. Write a registration file containing the bridge ID, protocol version, port, token, Pi PID, cwd, and session metadata.
4. Create the registration file with user-only permissions where supported and replace it atomically.
5. Update registration/session metadata when the session file becomes available.
6. Accept an authenticated qcode client and reject all commands until authentication succeeds.
7. Allow qcode to reconnect after an extension-host reload without restarting Pi.

Place registration files under a qcode-controlled directory in `ExtensionContext.globalStorageUri`, passing the exact file path in the terminal environment. This avoids hard-coding Pi's agent directory and allows each VS Code installation to manage its own bridge records.

On startup, qcode can scan this directory and reconnect to live bridge processes. Stale registrations must be detected by failed connection/PID checks and removed safely.

### Pi event subscriptions

Subscribe to:

- `session_start`
- `session_info_changed`
- `input`
- `session_tree`
- `session_compact`
- `model_select`
- `thinking_level_select`
- `agent_start`
- `agent_settled`
- `message_start`
- `message_update` if required
- `message_end`
- `tool_execution_start`
- `tool_execution_update` if required
- `tool_execution_end`
- `session_shutdown`

Use `ctx.sessionManager`, `ctx.model`, `pi.getThinkingLevel()`, and `ctx.getContextUsage()` to publish authoritative state. Send a refreshed active-branch snapshot after `/tree`, `/new`, `/resume`, `/fork`, `/clone`, reload, or any other session replacement/navigation flow.

Use the `input` event to publish the raw user-visible submission before skill/template expansion and to distinguish messages typed in the terminal from messages sent through `pi.sendUserMessage()`. Keep a FIFO correlation for accepted qcode sends so the resulting `user_input` event carries the client-message ID. For an initial positional prompt, qcode must pass a separate initial client-message ID in the terminal environment; the new bridge instance applies it exactly once to the first startup input generated by that prompt. This covers both new and resumed terminal launches without putting metadata into the user's message or model context.

### Persist compatible lifecycle markers

Fold the current `pi-lifecycle` persistence behavior into the bundled bridge. Treat the existing `pi-lifecycle` extension as the behavioral contract and port its marker logic without changing the custom type, schema, field meanings, or event timing. Use `pi.appendEntry("pi-lifecycle", data)` exactly as the existing extension does to append version-1 entries for:

- `session_start` with state `idle`
- the first `agent_start` of a logical run with state `busy` and a generated run ID
- `agent_end` with state `idle` from `agent_settled`, including the same run ID and elapsed time
- `session_shutdown` with state `idle`, shutdown reason, run ID when active, and elapsed time

Preserve the exact current data shape and values: `extension: "pi-lifecycle"`, `version: 1`, `event`, `state`, `timestamp: Date.now()`, `pid: process.pid`, and only the applicable `runId`, `sessionReason`, `shutdownReason`, and `elapsedMs` fields. Preserve the existing run semantics: clear run state on `session_start`; generate one `randomUUID()` on the first `agent_start`; ignore additional low-level `agent_start` events until settlement; append `agent_end` only from `agent_settled`; calculate elapsed time from the first start; and clear run state after settlement or shutdown. Append the settled/shutdown marker before publishing the equivalent bridge event and before cleanup when possible, so disk fallback has a durable boundary even if qcode is disconnected.

Do not migrate, rewrite, or reinterpret pre-existing marker entries. `src/sessionFiles.ts` must continue recognizing existing `type: "custom"`, `customType: "pi-lifecycle"` entries with the payload under `data`, including sessions containing markers written solely by the standalone extension.

These markers are required for every qcode-created bridge session, including sessions that are live-connected; bridge events replace markers only as the live transport, not as persisted rendering metadata. Since custom entries do not enter the LLM context, this does not violate the transport-only requirement.

Do not disable a user's separately installed `pi-lifecycle`. Make lifecycle parsing transition-idempotent so duplicate same-state markers from both extensions do not duplicate messages, prematurely finish a different run, or produce warnings.

### Receiving qcode messages

When `send_user_message` is received:

- Validate the request and reject empty or oversized text.
- If `ctx.isIdle()` is true, call `pi.sendUserMessage(text)`.
- If Pi is busy, call `pi.sendUserMessage(text, { deliverAs: "followUp" })`.
- Register the request/client-message ID before calling Pi, correlate it to the resulting `input` event, and return an acknowledgement or structured error using the request ID.
- Treat an acknowledgement as transport acceptance, not proof that the user message may be removed from optimistic UI state.
- Never append a user message directly to JSONL.
- Never start another agent process.

Store only the current extension instance's context. Session replacement creates a new extension instance, so all old sockets, timers, and captured session objects must be treated as stale after `session_shutdown`.

### Cleanup and reconnection

On `session_shutdown`:

- Append the compatible `session_shutdown` lifecycle marker first.
- Emit the shutdown event when possible.
- Close clients and the TCP server.
- Stop reconnect/heartbeat timers.
- Remove the registration file only if it still belongs to the current PID and bridge instance.

Test shutdown reasons `quit`, `reload`, `new`, `resume`, and `fork`. A replacement session should recreate the server and registration with the same terminal bridge ID so qcode can reconnect automatically.

If qcode disconnects, Pi must continue normally in the terminal. The bridge must continue listening for qcode to reconnect and must not terminate or interfere with Pi.

## Phase 3: Replace `messaging.ts` with Terminal/Bridge Session Management

Refactor `src/messaging.ts` into a manager responsible for terminal ownership and bridge connections, for example `src/piTerminalSessions.ts`.

The manager should track:

- bridge ID
- authentication token
- registration path
- terminal
- terminal exit state
- bridge socket and protocol state
- current session file and session ID
- pending command requests and timeouts
- reconnect state
- a pending outbound-message registry keyed by client-message ID, including text, target draft/session identity, pre-send leaf/sequence anchor, delivery state, and any correlated authoritative entry ID

### Starting a new session

1. Generate a cryptographically random bridge ID and token.
2. Create a unique registration-file path.
3. Create the visible VS Code terminal with bridge variables supplied through `TerminalOptions.env` rather than shell environment-assignment syntax.
4. Add `-e <bundled-bridge-path>` to the Pi command.
5. Preserve provider/model arguments and the initial positional user message.
6. Generate the client-message ID before launch, register the optimistic outbound message against the draft route, and pass that ID separately in `TerminalOptions.env` so the bridge can correlate the initial prompt.
7. Associate the current draft route with the bridge ID.
8. Watch for the registration file and connect to the bridge.
9. Use the bridge's reported session path to attach the draft UI to the real session without replacing or clearing the optimistic message; remove `waitForNewSessionFile()` and its 30-second directory polling.

### Resuming an existing session

If no live bridge owns the requested session:

1. Open a visible terminal.
2. Run Pi with the bundled bridge and `--session <path>`.
3. Supply the first new message as the initial positional prompt and pass its already-rendered client-message ID separately in the terminal environment.
4. Keep the optimistic message overlaid on the existing session snapshot while the resumed terminal and bridge start.
5. Connect when the bridge registers and reconcile the optimistic message with the first correlated authoritative input/message instead of appending a duplicate.

If a live bridge already owns the session, send the message through that bridge instead of opening another Pi process.

Never open two qcode-managed Pi terminals for the same resolved session path. Detect stale/dead terminals and bridge registrations before deciding to reuse them.

### Terminal behavior

- Do not hide or convert the terminal into a pseudoterminal.
- Do not consume Pi's stdout.
- Do not dispose a healthy terminal when the webview closes or the extension host temporarily disconnects.
- Keep the terminal named clearly enough for the user to find it.
- Preserve direct keyboard interaction with Pi.

### Cross-platform command construction

Replace the POSIX-only `PI_CACHE_RETENTION="long" pi` prefix with terminal environment options. Continue setting `PI_CACHE_RETENTION=long` for OpenAI Codex models, but set it through `TerminalOptions.env`.

Centralize shell quoting and test it for:

- POSIX shells
- PowerShell
- Windows Command Prompt if supported
- spaces and apostrophes in session/extension paths
- multiline prompts
- prompts beginning with `@`

If VS Code tasks with structured `ShellExecution` provide safer interactive argument handling without weakening the immediate-terminal behavior, evaluate them in a spike. Otherwise retain `Terminal.sendText()` with shell-specific quoting selected from the active shell.

## Phase 4: Drive Active Session UI from Bridge Events

Update `src/extension.ts` so the webview subscribes to the terminal/bridge manager rather than owning a map of `pi-msg` GUIDs.

For a bridge-connected detail view:

- Apply `session_snapshot` as the authoritative persisted baseline, then merge pending optimistic outbound messages over it. Do not pass snapshots directly to a destructive `replaceMessages` path.
- Render user messages from input/message events, including messages typed directly in the Pi terminal.
- Track tool starts by tool name to preserve the summarized activity display.
- Keep the latest assistant text as pending during a run.
- Publish only the final assistant result when `agent_settled` arrives, matching qcode's quiet UI.
- Use authoritative model/thinking/context state from the bridge.
- Play the completion sound on `agent_settled`, not inferred file changes.
- Handle errors, aborts, retries, compaction, and follow-up queues without declaring completion prematurely.
- Update the route when Pi changes sessions from the terminal through `/new`, `/resume`, `/fork`, or `/clone`.

When the user types in the terminal, qcode must update from the same bridge event stream. Moving between qcode and Pi must feel like two views over one active session, not two separate conversations.

### Optimistic user-message invariants

Treat qcode-submitted user messages as a small local outbox layered over the authoritative session state:

1. The webview generates a client-message ID and appends the user bubble synchronously in the submit handler, before terminal creation, socket connection, command acknowledgement, session-file discovery, or any snapshot.
2. The extension host records the same outbound item before starting/sending so it survives route attachment, webview rerendering, visibility changes, bridge reconnects, and extension-host state restoration where possible.
3. `sessionFileReady`, `session_snapshot`, watcher updates during migration, and reconnect snapshots merge with the outbox. An empty or stale snapshot must never clear an optimistic message.
4. Acknowledgement alone does not remove the outbox item. Reconcile it only when a correlated `user_input`/user-message event arrives or a later snapshot proves the corresponding ordered user entry exists after the pre-send leaf/sequence anchor.
5. Reconciliation replaces the optimistic item with the authoritative item in place, preserving order and scroll position. It must not briefly remove it and must not render both copies.
6. If delivery fails, keep the text visible and mark it as failed/retryable rather than silently deleting it. Retrying reuses the client-message ID or otherwise guarantees bridge-side idempotency.
7. Busy-session `followUp` messages stay visible immediately even though Pi will process them later; their queued state remains internal unless a separate product requirement adds queue UI.

Exercise this same path for:

- the first message in a blank new-session detail
- the first message after “Add to pi-qcode” populated a blank draft
- the first message used to launch/resume an existing inactive session
- a message sent to an already bridge-connected existing session
- a message sent while Pi is busy and it becomes a follow-up

### Internal-only connection state

Keep `connecting`, `connected`, `reconnecting`, `bridge incompatible`, `terminal exited`, and `bridge unavailable` in the terminal/bridge manager for routing, retry, cleanup, telemetry/logging, and command failure handling. Do not add a connection-status row, badge, banner, placeholder, or other status treatment to the session-detail UI.

Action-specific failures may still use an actionable VS Code error notification or output-channel log, but the normal UI must not expose ongoing terminal connection status. Do not silently fall back to writing directly into the terminal editor or session JSONL when the bridge is unavailable.

## Phase 5: Make JSONL an Inactive-Session Fallback

Retain `src/sessionFiles.ts` for home-screen discovery and sessions without a live bridge, but correct its session-tree handling.

### Branch-aware parsing

- Parse entries into an ID map.
- Determine the current leaf from append semantics/session metadata.
- Follow `parentId` from the current leaf to the root.
- Render only that active path rather than every entry in append order.
- Respect compaction, branch summaries, session info, model changes, and thinking-level changes on the active path.
- Refresh fallback rendering correctly after `/tree` changes the active leaf.

### Separate live transport from persisted rendering

Once bridge event handling is stable:

- Continue parsing `pi-lifecycle` markers for all persisted sessions and continue creating them from the bundled bridge for every qcode-created session.
- Use bridge events, rather than marker/file timing, to drive a connected session live; use the markers to preserve ideal user-plus-final-assistant rendering after the bridge is gone.
- Keep graceful best-effort compatibility parsing and its warning only for sessions/branches that genuinely lack lifecycle markers. A qcode bridge session must not enter compatibility mode merely because the standalone `pi-lifecycle` package is absent.
- Treat duplicate lifecycle entries as idempotent state transitions for users who still have the standalone extension installed.
- Remove live bridge sessions from `fs.watch` processing to avoid duplicate UI events.
- Stop calling `pi --list-models` for a connected session; use bridge model metadata.
- Retain a bounded fallback for unknown offline models.

Fix the existing truncation/reset behavior in the file watcher: if a file shrinks or is replaced, rebuild state from the file rather than moving the offset to the new end and skipping its contents.

Continue respecting malformed or partially written JSONL rows without crashing the extension host.

## Phase 6: Packaging, Configuration, and Documentation

### Packaging

- Ensure `pi-extensions/qcode-bridge.ts` is included in the VSIX.
- Keep `_planning/`, `node_modules/`, screenshots, and generated VSIX files excluded.
- Add a packaging verification that inspects the VSIX and confirms the bridge extension is present.
- Keep the bridge dependency-free at runtime.

### Pi compatibility

- Document the minimum supported Pi version that provides `agent_settled`, `pi.sendUserMessage()`, `ctx.getContextUsage()`, and the required session events.
- Validate protocol version in the handshake.
- Show an actionable “Update Pi” error when the bridge cannot load or reports incompatible APIs.
- Test `/reload`; because the bridge is passed with `-e`, verify the installed Pi version rebinds CLI extensions correctly during reload and session replacement.

### README and settings

Update `README.md` and `package.json` descriptions:

- Remove `pi-msg` and standalone `pi-lifecycle` installation prerequisites.
- Explain that qcode automatically loads its bundled bridge into qcode-created Pi terminals and that the bridge writes compatible `pi-lifecycle` custom entries for durable fallback rendering.
- Retain Pi CLI installation/authentication as a prerequisite.
- Emphasize that the terminal is the authoritative session and can be used directly at any time.
- Explain bridge connection errors and that the Pi terminal remains usable if qcode disconnects.

Do not automatically uninstall or disable users' existing `pi-msg` or `pi-lifecycle` packages. They may use them independently; qcode should simply stop depending on them.

## Phase 7: Tests and Validation

Add unit tests around modules that do not require the VS Code host:

- JSONL framing across split UTF-8 chunks.
- Multiple records in one network chunk.
- CRLF input handling.
- malformed/oversized record rejection.
- authentication and protocol-version rejection.
- request/ack correlation and timeout cleanup.
- idle versus busy `sendUserMessage` delivery selection.
- session snapshot sanitization.
- active-branch reconstruction from branched JSONL.
- compaction and branch-summary handling.
- registration-file stale-process cleanup.
- command quoting and environment construction.
- fixture-based parsing of pre-existing session files containing standalone `pi-lifecycle` entries.
- exact lifecycle marker parity with the standalone extension: custom type, payload shape, field omission, run guards, UUID reuse, elapsed time, event ordering, and `agent_settled`-to-`agent_end` persistence.
- duplicate lifecycle marker idempotency.
- optimistic outbox merge/reconciliation across empty, stale, and reconnect snapshots.
- client-message correlation and retry idempotency.
- absence of connection-status data from rendered webview state/HTML.

Add integration/manual validation for:

1. Start a blank new session from qcode; verify the submitted user message renders synchronously and never disappears while the terminal, bridge, and session file initialize.
2. Populate a blank draft through “Add to pi-qcode,” submit it, and verify the same no-flicker behavior.
3. Resume an inactive existing session with a new message; verify the old snapshot plus the new optimistic message remain visible continuously and reconcile without duplication.
4. Send messages to a connected session while idle and busy; verify follow-ups render immediately and reconcile once without duplication.
5. Type messages directly in Pi's terminal and see qcode update.
6. Switch repeatedly between terminal and qcode without duplicate messages.
7. Run tool-heavy turns and verify summarized activity plus only the final assistant response.
8. Abort from the Pi terminal.
9. Trigger automatic retry and compaction.
10. Use `/tree` and verify qcode shows only the selected branch.
11. Use `/new`, `/resume`, `/fork`, and `/clone` from the terminal.
12. Use `/model` and change thinking level from the terminal.
13. Use `/reload` and verify bridge reconnection.
14. Reload the VS Code extension host while Pi remains open, then reconnect through the registration file.
15. Close qcode while continuing to use Pi in the terminal.
16. Exit the Pi terminal and verify registration/session cleanup.
17. Open representative pre-existing sessions containing standalone `pi-lifecycle` markers and verify their user-plus-final-assistant rendering and warning behavior remain unchanged.
18. Run without `pi-msg` and standalone `pi-lifecycle` installed; verify new session files still contain compatible lifecycle markers and do not show the compatibility warning.
19. Run with standalone `pi-lifecycle` still installed; verify duplicate markers do not alter rendering.
20. Verify no connection status is shown during startup, reconnect, bridge incompatibility, or terminal exit.
21. Verify multiple VS Code windows and multiple simultaneous qcode terminals do not cross-connect.
22. Verify macOS, Linux, and Windows terminal launch behavior.
23. Compile with `npm run compile` and package the VSIX successfully.

## Migration Order

Implement incrementally to preserve a working extension:

1. Add protocol types, framing, and tests.
2. Add the bundled bridge extension, compatible lifecycle-marker persistence, and registration handshake while leaving current JSONL rendering active.
3. Add the terminal bridge manager, optimistic outbound-message registry, and exact new-session path from the bridge.
4. Route qcode messages through `pi.sendUserMessage()`, add client-message correlation/idempotency, and remove qcode's dependency on `pi-msg`.
5. Drive live completion and message rendering from bridge events while retaining bridge-created lifecycle markers for persisted rendering; remove only the dependency on the standalone `pi-lifecycle` package.
6. Add reconnect/session-replacement handling.
7. Make fallback JSONL parsing branch-aware.
8. Remove obsolete socket, polling, and active JSONL-watcher code.
9. Update prerequisites, README, packaging, and compatibility messaging.

During migration, a temporary feature flag may select the old transport for development rollback. Remove the flag and old transport after bridge behavior passes the validation checklist.

## Acceptance Criteria

- Pi always runs as a normal interactive process in a visible VS Code terminal.
- The user can click the terminal and immediately continue in the complete Pi TUI.
- qcode and the terminal show two views of the same Pi-owned session.
- Messages typed in either UI appear correctly in qcode.
- Every qcode-submitted user message renders synchronously and remains continuously visible across new-session launch, “Add to pi-qcode,” inactive-session resume, bridge connection/reconnection, and snapshot reconciliation, without duplicate bubbles.
- qcode does not start a second agent for an already active session.
- qcode uses Pi extension events—not JSONL timing heuristics—to determine active-run completion.
- New-session attachment does not poll the Pi sessions directory.
- New qcode sessions work without `pi-msg` and standalone `pi-lifecycle`, while the bundled bridge still writes compatible lifecycle custom entries.
- Pre-existing sessions containing standalone `pi-lifecycle` entries continue rendering as before without migration or rewriting.
- The bundled bridge creates the same `pi-lifecycle` custom type, version-1 payload, fields, omission rules, and lifecycle/run boundaries as the standalone extension.
- Persisted qcode bridge sessions render user messages plus final assistant messages without entering compatibility mode solely because the standalone lifecycle package is absent.
- Terminal/bridge connection status is never shown in the qcode UI.
- The bridge does not alter the model's prompt, tools, or conversation context.
- `/tree`, `/new`, `/resume`, `/fork`, `/clone`, `/model`, thinking changes, and `/reload` remain usable from the Pi terminal.
- A qcode disconnect never terminates or prevents direct use of the Pi terminal.
- Inactive and legacy sessions remain viewable through branch-aware JSONL fallback rendering.
- The implementation works with multiple terminals/windows without cross-session message delivery.
- The bundled bridge is present in the packaged VSIX and no Pi SDK runtime dependency is added.
