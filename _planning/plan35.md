# Plan 35: Remove the Message Retry UI

## Goal

Remove the rarely useful Retry button and failed-delivery decoration from chat messages. When Pi or the local bridge rejects a submission, rely on the existing VS Code error notification. The submitted text remains visible in the optimistic user message, so the user can copy it and submit it again manually if needed.

## Scope

### `src/webviews/sessionDetail.ts`

1. Remove the `.retry-message` styles.
2. Remove the `.session-message.delivery-failed` styles.
3. Simplify `renderMessageElement()` so it no longer:
   - adds the `delivery-failed` class;
   - adds the failed-delivery tooltip;
   - creates a Retry button;
   - posts a second `sendMessage` command from a retry click handler.
4. Continue rendering the optimistic user message as an ordinary user message.

### Delivery internals

Do not broaden this change into a rewrite of optimistic-message correlation. Keep `clientMessageId` and the internal delivery state in `src/piTerminalSessions.ts` for now because they also participate in acknowledgement ordering, authoritative-message correlation, and snapshot reconciliation. They no longer need a visible webview treatment.

Keep the existing error path in `src/extension.ts`: `handleSendMessage()` catches the bridge/terminal error and calls `vscode.window.showErrorMessage()` with the actionable error text.

## Tests

Add or update a focused webview-rendering test that verifies the generated session-detail HTML contains no:

- `Retry` button creation;
- `retry-message` class;
- `delivery-failed` class;
- retry-specific `sendMessage` click handler.

Run:

```bash
npm test
```

## Manual Verification

1. Start a session and send one normal message so the Pi bridge is connected.
2. Submit a message larger than the bridge's 256 KiB limit.
3. Confirm that VS Code shows the bridge error notification.
4. Confirm that the optimistic user message remains a normal user message with no red failed state, tooltip, or Retry button.
5. Confirm that its text can still be selected/copied for manual resubmission.

## Out of Scope

- Retrying arbitrary historical messages.
- Automatically restoring failed text to the composer.
- Attachment-specific retry behavior.
- Changing bridge acknowledgement, timeout, or optimistic reconciliation behavior.
