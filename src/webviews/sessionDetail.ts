import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
  type ChatAttachment,
} from "../chatAttachments";
import type { ProviderOption } from "../qcodeSettings";
import type { SessionDetail } from "../sessionFiles";
import { escapeHtml } from "../utils";
import {
  messageRenderingScript,
  messageRenderingStyles,
  renderSessionMessage,
} from "./messageRendering";

export function renderSessionDetail(
  filePath: string,
  nonce: string,
  session: SessionDetail,
  options: {
    autoFocus?: boolean;
    initialInput?: string;
    initialAttachments?: ChatAttachment[];
    providerOptions?: ProviderOption[];
    lastUsedProviderNickname?: string;
    assistantSoundEnabled?: boolean;
    assistantSoundUri?: string;
    mermaidScriptUri?: string;
    cspSource?: string;
    waitingForUser?: boolean;
    waitingForUserMessage?: string;
  } = {},
): string {
  const isDraftSession = !filePath && !session.filePath && !session.error;
  const providerOptions = options.providerOptions ?? [];
  const lastUsedProviderNickname = options.lastUsedProviderNickname ?? "";
  const resourceCspSource = options.cspSource || "'none'";
  const scriptResourceCspSource = options.cspSource
    ? ` ${options.cspSource}`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'${scriptResourceCspSource}; connect-src ${resourceCspSource}; media-src ${resourceCspSource}; form-action 'none';">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    overflow: hidden;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .detail {
    height: 100vh;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 2px;
    border-bottom: 1px solid var(--vscode-widget-border, transparent);
  }
  .home-button,
  .submit-button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
  }
  .home-button {
    padding: 2px 8px;
    font-size: 18px;
    line-height: 1;
  }
  .submit-button {
    width: 28px;
    height: 26px;
    flex: 0 0 auto;
  }
  .home-button:hover,
  .submit-button:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .submit-button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .context-usage {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    white-space: nowrap;
  }
  .context-usage-value {
    flex: 0 0 auto;
  }
  .session-warning {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    padding: 0;
    color: var(--vscode-charts-yellow, #cca700);
    background: transparent;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    line-height: 22px;
  }
  .session-warning:hover {
    background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
  }
  .session-warning[hidden] {
    display: none !important;
  }
  .context-usage-token-warning {
    color: var(--vscode-charts-yellow, #cca700);
  }
  .context-usage-token-danger {
    color: var(--vscode-charts-red, var(--vscode-errorForeground, #f14c4c));
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    margin-right: -7px;
    padding: 16px 9px 16px 2px;
  }
  .messages {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .session-message {
    padding: 10px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-right: 3px solid var(--vscode-widget-border, transparent);
    border-radius: 5px;
  }
  .session-message.role-user {
    border-right-color: var(--vscode-charts-blue, #3794ff);
  }
  .session-message.role-assistant {
    border-right-color: var(--vscode-widget-border, transparent);
  }
  .session-message.role-thinking {
    color: var(--vscode-descriptionForeground);
    background: transparent;
    border-style: dashed;
    border-right-color: var(--vscode-descriptionForeground);
  }
  .session-message.role-thinking.role-waiting {
    color: var(--vscode-foreground);
    background: var(--vscode-inputValidation-warningBackground, var(--vscode-input-background));
    border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-charts-yellow, #cca700));
    border-style: solid;
  }
  .thinking-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .thinking-elapsed {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    letter-spacing: normal;
  }
${messageRenderingStyles}
  .draft-provider-options {
    margin-bottom: 12px;
    padding: 10px;
    color: var(--vscode-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 5px;
  }
  .draft-provider-label {
    display: block;
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 700;
  }
  .draft-provider-select {
    width: 100%;
    min-width: 0;
    padding: 5px 6px;
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
    border-radius: 3px;
    font: inherit;
  }
  .draft-provider-message,
  .empty-messages {
    color: var(--vscode-descriptionForeground);
    line-height: 1.45;
    text-align: center;
  }
  .error {
    color: var(--vscode-errorForeground);
    line-height: 1.45;
  }
  .footer {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 5px 0 3px;
    border-top: 1px solid var(--vscode-widget-border, transparent);
  }
  .composer-attachments {
    width: 100%;
    margin: 0;
  }
  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    width: 100%;
  }
  .message-input {
    min-width: 0;
    min-height: 26px;
    max-height: calc(1.35em * 22 + 10px);
    flex: 1 1 auto;
    padding: 4px 6px;
    overflow-y: auto;
    resize: none;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    font: inherit;
    line-height: 1.35;
  }
  .message-input:focus {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: -1px;
  }
  .typeahead[hidden] {
    display: none !important;
  }
  .typeahead {
    position: absolute;
    right: 34px;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 10;
    max-height: 220px;
    overflow-y: auto;
    padding: 4px;
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, transparent));
    border-radius: 4px;
    box-shadow: 0 3px 8px rgb(0 0 0 / 28%);
  }
  .typeahead-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .typeahead-item {
    width: 100%;
    min-width: 0;
    padding: 5px 7px;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .typeahead-item.is-selected {
    color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
    background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
  }
  .typeahead-label,
  .typeahead-description {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .typeahead-label {
    font-size: 12px;
    font-weight: 600;
  }
  .typeahead-description,
  .typeahead-empty {
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
  }
  .typeahead-empty {
    padding: 6px 7px;
  }
</style>
</head>
<body>
  <main class="detail">
    <header class="header">
      <button type="button" class="home-button" id="home-button" aria-label="Home" title="Home">←</button>
      <div class="context-usage" id="context-usage" aria-label="Context window usage and session cost" title="Context usage and session cost unavailable"><span class="context-usage-value">—%</span><span class="context-usage-value">$—</span></div>
      <button type="button" class="session-warning" id="session-warning" aria-label="Session warnings" title="Session warnings" hidden>⚠</button>
    </header>
    <section class="body">
      ${renderSessionDetailBody(
        session,
        providerOptions,
        isDraftSession,
        lastUsedProviderNickname,
      )}
    </section>
    <form class="footer" id="message-form" data-file-path="${escapeHtml(filePath)}">
      <div class="typeahead" id="typeahead" role="listbox" aria-label="Autocomplete suggestions" hidden>
        <div class="typeahead-list" id="typeahead-list"></div>
      </div>
      <div class="attachment-list composer-attachments" id="composer-attachments" aria-label="Pasted attachments" hidden></div>
      <div class="input-row">
        <textarea class="message-input" id="message-input" rows="2" aria-label="Message" placeholder="${escapeHtml(getMessagePlaceholder())}"></textarea>
        <button class="submit-button" id="submit-button" type="submit" aria-label="Submit">➤</button>
      </div>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('message-form');
    const input = document.getElementById('message-input');
    const messages = document.getElementById('messages');
    const contextUsage = document.getElementById('context-usage');
    const sessionWarning = document.getElementById('session-warning');
    const typeahead = document.getElementById('typeahead');
    const typeaheadList = document.getElementById('typeahead-list');
    const composerAttachmentList = document.getElementById('composer-attachments');
    const submitButton = document.getElementById('submit-button');
    let completionState = null;
    let completionSuggestions = [];
    let selectedSuggestionIndex = 0;
    let searchRequestId = 0;
    let searchTimer = undefined;
    const providerOptions = ${toScriptJson(providerOptions)};
    const lastUsedProviderNickname = ${toScriptJson(lastUsedProviderNickname)};
    let sessionWarnings = [];
    let waitingForUserActive = false;
    const composerAttachments = ${toScriptJson(
      (options.initialAttachments ?? []).map((attachment) => ({
        requestId: "",
        status: "ready",
        attachment,
      })),
    )};
    const maxChatAttachments = ${MAX_CHAT_ATTACHMENTS};
    const maxChatAttachmentsTotalBytes = ${MAX_CHAT_ATTACHMENTS_TOTAL_BYTES};
    const discardedAttachmentRequests = new Set();

    const readSessionWarnings = (warnings) => {
      if (!Array.isArray(warnings)) return [];
      return warnings.filter((warning) => warning && typeof warning.message === 'string' && warning.message.trim());
    };
    const updateSessionWarnings = (warnings) => {
      sessionWarnings = readSessionWarnings(warnings);
      if (!sessionWarning) return;

      sessionWarning.hidden = !sessionWarnings.length;
      const title = sessionWarnings.length === 1
        ? String(sessionWarnings[0].title || 'Session warning')
        : sessionWarnings.length + ' session warnings';
      sessionWarning.title = title;
      sessionWarning.setAttribute('aria-label', title);
    };

    const updateUserInputWait = (waiting, message) => {
      const startedWaiting = waiting && !waitingForUserActive;
      waitingForUserActive = waiting;
      if (startedWaiting) playNotificationSound();
      if (!messages) return;
      const activeWait = messages.querySelector('.session-message[data-user-input-wait="true"]');
      if (!waiting) {
        if (!activeWait) return;
        if (activeWait.dataset.syntheticUserInputWait === 'true') {
          activeWait.remove();
          if (!messages.children.length) renderEmptyMessages();
          syncThinkingElapsedTimer();
          return;
        }
        activeWait.classList.remove('role-waiting');
        activeWait.removeAttribute('role');
        activeWait.removeAttribute('aria-live');
        renderThinkingLabel(activeWait.querySelector('.thinking-label'));
        activeWait.querySelector('.message-text').textContent = activeWait.dataset.originalWaitText || '';
        delete activeWait.dataset.userInputWait;
        delete activeWait.dataset.originalWaitLabel;
        delete activeWait.dataset.originalWaitText;
        syncThinkingElapsedTimer();
        return;
      }

      let article = activeWait;
      if (!article) {
        article = messages.querySelector('.session-message.role-thinking:last-child');
      }
      if (!article) {
        messages.querySelector('.empty-messages')?.remove();
        article = document.createElement('article');
        article.className = 'session-message role-thinking';
        article.dataset.syntheticUserInputWait = 'true';
        const label = document.createElement('div');
        label.className = 'thinking-label';
        const text = document.createElement('div');
        text.className = 'message-text';
        article.append(label, text);
        messages.append(article);
      }

      const label = article.querySelector('.thinking-label');
      const text = article.querySelector('.message-text');
      if (article.dataset.userInputWait !== 'true') {
        article.dataset.originalWaitLabel = label?.textContent || 'Thinking...';
        article.dataset.originalWaitText = text?.textContent || '';
      }
      article.dataset.userInputWait = 'true';
      article.classList.add('role-waiting');
      article.setAttribute('role', 'status');
      article.setAttribute('aria-live', 'polite');
      if (label) label.textContent = 'Waiting for you... see pi terminal';
      if (text) text.textContent = message || 'Open the Pi terminal to continue.';
      syncThinkingElapsedTimer();
    };

    const assistantSoundEnabled = ${options.assistantSoundEnabled === true ? "true" : "false"};
    const assistantSoundUri = ${toScriptString(options.assistantSoundUri ?? "")};
    let notificationAudioContext = null;
    let notificationAudioBufferPromise = null;
    const getNotificationAudioContext = () => {
      if (!assistantSoundEnabled || !assistantSoundUri) return null;
      if (notificationAudioContext) return notificationAudioContext;
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return null;
      notificationAudioContext = new AudioContextConstructor();
      return notificationAudioContext;
    };
    const loadNotificationAudioBuffer = () => {
      const audioContext = getNotificationAudioContext();
      if (!audioContext) return Promise.resolve(null);
      if (notificationAudioBufferPromise) return notificationAudioBufferPromise;

      notificationAudioBufferPromise = fetch(assistantSoundUri)
        .then((response) => {
          if (!response.ok) throw new Error('Unable to load notification sound.');
          return response.arrayBuffer();
        })
        .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
        .catch(() => null);
      return notificationAudioBufferPromise;
    };
    const unlockNotificationAudio = () => {
      if (!assistantSoundEnabled) return;
      const audioContext = getNotificationAudioContext();
      if (!audioContext) return;
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      loadNotificationAudioBuffer();
    };
    const playNotificationSoundInWebview = () => {
      if (!assistantSoundEnabled) return;
      const audioContext = getNotificationAudioContext();
      if (!audioContext) return;

      const play = (audioBuffer) => {
        if (!audioBuffer) return;
        try {
          const source = audioContext.createBufferSource();
          const gain = audioContext.createGain();
          source.buffer = audioBuffer;
          gain.gain.value = 0.8;
          source.connect(gain);
          gain.connect(audioContext.destination);
          source.start();
        } catch {
          // Ignore audio failures; the message should still render normally.
        }
      };

      const loadAndPlay = () => loadNotificationAudioBuffer().then(play).catch(() => {});
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(loadAndPlay).catch(() => {});
        return;
      }

      loadAndPlay();
    };
    const playNotificationSound = () => {
      if (!assistantSoundEnabled) return;
      vscode.postMessage({ command: 'playNotificationSound' });
    };

    const resizeInput = () => {
      input.style.height = 'auto';
      const styles = getComputedStyle(input);
      const maxHeight = Number.parseFloat(styles.maxHeight);
      const borderHeight = Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
      const nextHeight = Math.min(input.scrollHeight + borderHeight, maxHeight);
      input.style.height = nextHeight + 'px';
      input.style.overflowY = input.scrollHeight + borderHeight > maxHeight ? 'auto' : 'hidden';
    };
    const scrollLastMessageTop = () => {
      const lastMessage = messages && messages.querySelector('.session-message:last-child');
      if (lastMessage) lastMessage.scrollIntoView({ block: 'start' });
    };
    const renderEmptyMessages = () => {
      if (!messages) return;
      const empty = document.createElement('div');
      empty.className = 'empty-messages';
      empty.textContent = 'No messages found in this session.';
      messages.append(empty);
    };
    const renderedMessages = ${toScriptJson(session.messages)};
    const isThinkingMessage = (message) => Boolean(message && message.kind === 'thinking');
    const isAssistantMessage = (message) => Boolean(message && message.kind !== 'thinking' && message.role === 'assistant');
    let thinkingStartedAt = undefined;
    let thinkingElapsedTimer = undefined;
    const formatElapsedTime = (elapsedMs) => {
      const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
      const seconds = totalSeconds % 60;
      const totalMinutes = Math.floor(totalSeconds / 60);
      if (totalMinutes < 1) return seconds + 's';
      const minutes = totalMinutes % 60;
      const hours = Math.floor(totalMinutes / 60);
      if (hours < 1) return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
      return hours + 'h ' + String(minutes).padStart(2, '0') + 'm ' + String(seconds).padStart(2, '0') + 's';
    };
    const renderThinkingLabel = (label) => {
      if (!label) return;
      const text = document.createElement('span');
      text.textContent = 'Thinking...';
      const elapsed = document.createElement('span');
      elapsed.className = 'thinking-elapsed';
      label.replaceChildren(text, elapsed);
    };
    const updateThinkingElapsed = () => {
      const article = messages && messages.querySelector('.session-message.role-thinking:not(.role-waiting):last-child');
      const elapsed = article && article.querySelector('.thinking-elapsed');
      if (!elapsed) return;
      elapsed.textContent = formatElapsedTime(Date.now() - (thinkingStartedAt ?? Date.now()));
      elapsed.title = 'Time elapsed while thinking';
    };
    const syncThinkingElapsedTimer = () => {
      const thinking = messages && messages.querySelector('.session-message.role-thinking:last-child');
      const shouldRun = Boolean(thinking && !thinking.classList.contains('role-waiting'));
      if (!shouldRun) {
        thinkingStartedAt = undefined;
        if (thinkingElapsedTimer !== undefined) window.clearInterval(thinkingElapsedTimer);
        thinkingElapsedTimer = undefined;
        return;
      }
      if (thinkingStartedAt === undefined) thinkingStartedAt = Date.now();
      updateThinkingElapsed();
      if (thinkingElapsedTimer === undefined) {
        thinkingElapsedTimer = window.setInterval(updateThinkingElapsed, 1000);
      }
    };
    const thinkingInfoSignature = (message) => JSON.stringify([
      String(message?.text || ''),
      Object.entries(message?.counts || {}).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const hasThinkingInfoChanged = (previousMessage, nextMessage) =>
      isThinkingMessage(previousMessage) &&
      isThinkingMessage(nextMessage) &&
      thinkingInfoSignature(previousMessage) !== thinkingInfoSignature(nextMessage);
    const resetThinkingElapsedIfChanged = (previousMessage, nextMessage) => {
      if (hasThinkingInfoChanged(previousMessage, nextMessage)) {
        thinkingStartedAt = Date.now();
      }
    };
    const messageRenderSlot = (message) => {
      if (!message) return '';
      return (message.kind || 'message') + ':' + (message.role || '');
    };
    const shouldScrollForReplacement = (newMessages) => {
      if (!Array.isArray(newMessages) || !newMessages.length) return false;
      if (!renderedMessages.length) return true;
      if (newMessages.length > renderedMessages.length) return true;

      const previousLast = renderedMessages[renderedMessages.length - 1];
      const nextLast = newMessages[newMessages.length - 1];
      return messageRenderSlot(previousLast) !== messageRenderSlot(nextLast);
    };
${messageRenderingScript}
    const getReadyAttachments = () => composerAttachments
      .filter((item) => item.status === 'ready' && item.attachment)
      .map((item) => item.attachment);
    const updateSubmitButton = () => {
      const isSaving = composerAttachments.some((item) => item.status === 'saving');
      submitButton.disabled = isSaving || (!input.value && getReadyAttachments().length === 0);
    };
    const removeComposerAttachment = (item) => {
      const index = composerAttachments.indexOf(item);
      if (index !== -1) composerAttachments.splice(index, 1);
      if (item.status === 'saving') discardedAttachmentRequests.add(item.requestId);
      if (item.attachment?.path) {
        vscode.postMessage({ command: 'removePastedAttachment', attachment: item.attachment });
      }
      renderComposerAttachments();
    };
    const renderComposerAttachments = () => {
      composerAttachmentList.replaceChildren();
      composerAttachments.forEach((item) => {
        const attachment = item.attachment || {
          name: item.name || 'pasted-file',
          size: item.size,
        };
        composerAttachmentList.append(qcodeMessageRendering.createAttachmentRow(attachment, {
          status: item.status === 'saving' ? 'Saving…' : '',
          error: item.status === 'error' ? (item.error || 'Unable to save attachment.') : '',
          onRemove: () => removeComposerAttachment(item),
        }));
      });
      composerAttachmentList.hidden = composerAttachments.length === 0;
      updateSubmitButton();
    };
    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result || '')));
      reader.addEventListener('error', () => reject(reader.error || new Error('Unable to read clipboard file.')));
      reader.readAsDataURL(file);
    });
    const queuePastedFile = (file) => {
      const existingTotalBytes = composerAttachments.reduce(
        (total, item) => {
          const size = item.attachment?.size ?? item.size;
          return total + (Number.isFinite(size) ? size : 0);
        },
        0,
      );
      const limitError = composerAttachments.length >= maxChatAttachments
        ? 'A message can include at most ' + maxChatAttachments + ' attachments.'
        : existingTotalBytes + file.size > maxChatAttachmentsTotalBytes
          ? 'Attachments in one message must total 50 MiB or less. You can reference additional files by their paths instead.'
          : '';
      if (limitError) {
        const requestId = globalThis.crypto.randomUUID();
        composerAttachments.push({
          requestId,
          status: 'error',
          name: file.name || 'pasted-file',
          size: file.size,
          error: limitError,
        });
        renderComposerAttachments();
        return;
      }
      const requestId = globalThis.crypto.randomUUID();
      const item = {
        requestId,
        status: 'saving',
        name: file.name || '',
        mimeType: file.type || '',
        size: file.size,
      };
      composerAttachments.push(item);
      renderComposerAttachments();
      readFileAsDataUrl(file).then((data) => {
        if (discardedAttachmentRequests.has(requestId)) return;
        vscode.postMessage({
          command: 'savePastedAttachment',
          requestId,
          name: file.name || '',
          mimeType: file.type || '',
          size: file.size,
          data,
        });
      }).catch((error) => {
        if (discardedAttachmentRequests.has(requestId)) return;
        item.status = 'error';
        item.error = error instanceof Error ? error.message : String(error);
        renderComposerAttachments();
      });
    };
    const renderMessageElement = (message) => {
      const article = document.createElement('article');
      const roleClass = message.kind === 'thinking'
        ? 'role-thinking'
        : message.role === 'user'
          ? 'role-user'
          : 'role-assistant';
      article.className = 'session-message ' + roleClass;

      if (message.kind === 'thinking') {
        const label = document.createElement('div');
        label.className = 'thinking-label';
        renderThinkingLabel(label);
        article.append(label);
      }

      const text = document.createElement('div');
      qcodeMessageRendering.renderMessageTextElement(text, message);
      if (!message.text && Array.isArray(message.attachments) && message.attachments.length) text.hidden = true;
      article.append(text);
      if (Array.isArray(message.attachments) && message.attachments.length) {
        const attachmentList = document.createElement('div');
        attachmentList.className = 'attachment-list';
        qcodeMessageRendering.renderAttachmentList(attachmentList, message.attachments, { clickable: true });
        article.append(attachmentList);
      }
      return article;
    };
    const appendMessage = (message) => {
      if (!messages) return false;

      const empty = messages.querySelector('.empty-messages');
      if (empty) empty.remove();

      const previousThinking = renderedMessages[renderedMessages.length - 1];
      const wasThinkingUpdate = isThinkingMessage(previousThinking) && isThinkingMessage(message);
      resetThinkingElapsedIfChanged(previousThinking, message);
      const lastMessage = messages.querySelector('.session-message:last-child');
      if (lastMessage && lastMessage.classList.contains('role-thinking')) {
        lastMessage.remove();
      }
      if (isThinkingMessage(renderedMessages[renderedMessages.length - 1])) {
        renderedMessages.pop();
      }

      messages.append(renderMessageElement(message));
      renderedMessages.push(message);
      if (isAssistantMessage(message)) playNotificationSound();
      syncThinkingElapsedTimer();
      return !wasThinkingUpdate;
    };
    const replaceMessages = (newMessages) => {
      if (!messages) return false;
      const shouldScroll = shouldScrollForReplacement(newMessages);
      const previousThinking = renderedMessages[renderedMessages.length - 1];
      const nextThinking = newMessages[newMessages.length - 1];
      resetThinkingElapsedIfChanged(previousThinking, nextThinking);
      messages.replaceChildren();
      renderedMessages.splice(0, renderedMessages.length, ...newMessages);
      if (!newMessages.length) {
        renderEmptyMessages();
        syncThinkingElapsedTimer();
        return false;
      }
      newMessages.forEach((message) => messages.append(renderMessageElement(message)));
      syncThinkingElapsedTimer();
      return shouldScroll;
    };
    const formatTokens = (value) => {
      const numberValue = Number(value || 0);
      if (!Number.isFinite(numberValue) || numberValue <= 0) return '0';
      if (numberValue >= 1000000) return (numberValue / 1000000).toFixed(numberValue >= 10000000 ? 0 : 1) + 'M';
      if (numberValue >= 1000) return (numberValue / 1000).toFixed(numberValue >= 10000 ? 0 : 1) + 'K';
      return String(Math.round(numberValue));
    };
    const readFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
    const formatCost = (value) => {
      const numberValue = readFiniteNumber(value);
      if (numberValue === undefined || numberValue < 0) return undefined;
      const decimals = numberValue > 0 && numberValue < 0.01
        ? 4
        : numberValue > 0 && numberValue < 1
          ? 3
          : 2;
      return '$' + numberValue.toFixed(decimals);
    };
    const getContextUsageColorClass = (usedTokens) => {
      if (!Number.isFinite(usedTokens) || usedTokens < 100000) return '';
      if (usedTokens < 150000) return ' context-usage-token-warning';
      return ' context-usage-token-danger';
    };
    const updateContextUsage = (usage) => {
      if (!contextUsage) return;

      const used = readFiniteNumber(usage && usage.usedTokens);
      const total = readFiniteNumber(usage && usage.contextWindow);
      const reportedPercent = readFiniteNumber(usage && usage.percent);
      const rawPercent = reportedPercent !== undefined
        ? reportedPercent
        : used !== undefined && used >= 0 && total !== undefined && total > 0
          ? (used / total) * 100
          : undefined;
      const hasPercent = rawPercent !== undefined && rawPercent >= 0;
      const cost = formatCost(usage && usage.sessionCost);

      const percentElement = document.createElement('span');
      percentElement.className = 'context-usage-value' + getContextUsageColorClass(used);
      percentElement.textContent = hasPercent ? rawPercent.toFixed(1) + '%' : '—%';
      const costElement = document.createElement('span');
      costElement.className = 'context-usage-value';
      costElement.textContent = cost || '$—';
      contextUsage.replaceChildren(percentElement, costElement);

      const metadata = [];
      if (usage && usage.modelId) metadata.push(usage.modelId);
      if (usage && usage.thinkingLevel) metadata.push('reasoning ' + usage.thinkingLevel);
      const tokenDetail = used !== undefined && total !== undefined && total > 0
        ? ' (' + formatTokens(used) + ' / ' + formatTokens(total) + ' tokens)'
        : '';
      const titleParts = [
        hasPercent
          ? 'Context window used: ' + rawPercent.toFixed(1) + '%' + tokenDetail
          : 'Context usage unavailable',
        cost ? 'Session cost: ' + cost : 'Session cost unavailable',
      ];
      if (metadata.length) titleParts.push(metadata.join(' · '));
      const title = titleParts.join(' · ');
      contextUsage.title = title;
      contextUsage.setAttribute('aria-valuetext', title);
    };
    const hideTypeahead = () => {
      completionState = null;
      completionSuggestions = [];
      selectedSuggestionIndex = 0;
      searchRequestId += 1;
      typeahead.hidden = true;
      typeaheadList.replaceChildren();
      if (searchTimer) window.clearTimeout(searchTimer);
    };
    const showTypeaheadMessage = (message) => {
      typeaheadList.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'typeahead-empty';
      empty.textContent = message;
      typeaheadList.append(empty);
      typeahead.hidden = false;
    };
    const updateTypeaheadSelection = () => {
      typeaheadList.querySelectorAll('.typeahead-item').forEach((item) => {
        const isSelected = Number(item.dataset.index) === selectedSuggestionIndex;
        item.classList.toggle('is-selected', isSelected);
        item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });
    };
    const renderTypeahead = () => {
      typeaheadList.replaceChildren();
      if (!completionSuggestions.length) {
        const message = completionState && completionState.kind === 'hash'
          ? 'No matching # options'
          : 'No matching files';
        showTypeaheadMessage(message);
        return;
      }

      completionSuggestions.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'typeahead-item' + (index === selectedSuggestionIndex ? ' is-selected' : '');
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', index === selectedSuggestionIndex ? 'true' : 'false');
        button.dataset.index = String(index);

        const label = document.createElement('span');
        label.className = 'typeahead-label';
        label.textContent = item.label || item.command || item.path || '';

        const description = document.createElement('span');
        description.className = 'typeahead-description';
        description.textContent = item.description || item.value || item.path || '';

        button.append(label, description);
        button.addEventListener('mousemove', () => {
          if (selectedSuggestionIndex === index) return;
          selectedSuggestionIndex = index;
          updateTypeaheadSelection();
        });
        button.addEventListener('mousedown', (event) => {
          event.preventDefault();
          insertSelectedCompletion(index);
        });
        typeaheadList.append(button);
      });
      typeahead.hidden = false;
    };
    const getCompletionState = () => {
      const cursorPosition = input.selectionStart ?? input.value.length;
      if ((input.selectionEnd ?? cursorPosition) !== cursorPosition) return null;

      const beforeCursor = input.value.slice(0, cursorPosition);
      const atIndex = beforeCursor.lastIndexOf('@');
      const hashIndex = beforeCursor.lastIndexOf('#');
      const triggerIndex = Math.max(atIndex, hashIndex);
      if (triggerIndex === -1) return null;

      const trigger = beforeCursor[triggerIndex];
      const query = beforeCursor.slice(triggerIndex + 1);
      if (/\\s/.test(query)) return null;
      if (trigger === '@' && query.toLowerCase().startsWith('http')) return null;

      return {
        kind: trigger === '#' ? 'hash' : 'file',
        triggerIndex,
        cursorPosition,
        query,
      };
    };
    const updateTypeahead = () => {
      const state = getCompletionState();
      if (!state) {
        hideTypeahead();
        return;
      }

      completionState = state;
      showTypeaheadMessage(state.kind === 'hash' ? 'Searching # options...' : 'Searching files...');
      if (searchTimer) window.clearTimeout(searchTimer);
      const requestId = ++searchRequestId;
      searchTimer = window.setTimeout(() => {
        vscode.postMessage({
          command: state.kind === 'hash' ? 'searchHashOptions' : 'searchFiles',
          requestId,
          query: state.query,
        });
      }, 100);
    };
    const insertSelectedCompletion = (index = selectedSuggestionIndex) => {
      const item = completionSuggestions[index];
      if (!item) return;

      const state = completionState || getCompletionState();
      if (!state) return;

      if (state.kind === 'hash') {
        if (typeof item.value !== 'string') return;
        const beforeTrigger = input.value.slice(0, state.triggerIndex);
        const afterTrigger = input.value.slice(state.cursorPosition);
        const suffix = afterTrigger.startsWith(' ') ? afterTrigger : ' ' + afterTrigger;
        input.value = beforeTrigger + item.value + suffix;
        const nextCursorPosition = beforeTrigger.length + item.value.length + 1;
        input.setSelectionRange(nextCursorPosition, nextCursorPosition);
      } else {
        if (!item.path) return;
        const mentionPath = String(item.path || '');
        const beforeMention = input.value.slice(0, state.triggerIndex + 1);
        const afterMention = input.value.slice(state.cursorPosition);
        const suffix = afterMention.startsWith(' ') ? afterMention : ' ' + afterMention;
        input.value = beforeMention + mentionPath + suffix;
        const nextCursorPosition = beforeMention.length + mentionPath.length + 1;
        input.setSelectionRange(nextCursorPosition, nextCursorPosition);
      }

      resizeInput();
      hideTypeahead();
      input.focus();
    };
    const addToInput = (text) => {
      if (!text) return;
      input.value = input.value ? input.value + String.fromCharCode(10) + text : text;
      resizeInput();
      updateSubmitButton();
      input.focus();
    };
    const addReplyToInput = (text) => {
      if (!text) return;
      const lineBreak = String.fromCharCode(10);
      const codeFence = String.fromCharCode(96).repeat(3);
      addToInput('RE:' + lineBreak + codeFence + lineBreak + text + lineBreak + codeFence + lineBreak);
    };
    const getSelectedProviderOption = () => {
      if (form.dataset.filePath) return undefined;

      const select = document.getElementById('draft-provider-select');
      if (!select) return undefined;

      const index = Number(select.value);
      if (!Number.isInteger(index) || index < 0 || index >= providerOptions.length) return undefined;
      return providerOptions[index];
    };
    const getSelectedProviderCliArgs = () => {
      return String(getSelectedProviderOption()?.cliArgs || '');
    };
    const removeDraftProviderOptions = () => {
      document.getElementById('draft-provider-options')?.remove();
    };
    const initialInput = ${toScriptString(options.initialInput ?? "")};
    qcodeMessageRendering.configureMermaid({
      scriptUri: ${toScriptString(options.mermaidScriptUri ?? "")},
      nonce: ${toScriptString(nonce)},
    });
    qcodeMessageRendering.installClickHandlers(vscode, { onReply: addReplyToInput });
    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
      window.addEventListener(eventName, unlockNotificationAudio, { once: true, passive: true });
    });
    qcodeMessageRendering.renderExistingMessages();
    renderComposerAttachments();
    syncThinkingElapsedTimer();
    updateContextUsage(${toScriptJson(session.contextUsage)});
    updateSessionWarnings(${toScriptJson(session.warnings ?? [])});
    updateUserInputWait(
      ${options.waitingForUser === true ? "true" : "false"},
      ${toScriptString(options.waitingForUserMessage ?? "")},
    );
    if (initialInput) addToInput(initialInput);

    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({
        command: 'home',
        filePath: form.dataset.filePath || '',
        draftText: input.value,
        draftAttachments: getReadyAttachments(),
      });
    });
    sessionWarning?.addEventListener('click', () => {
      vscode.postMessage({ command: 'showSessionWarnings', warnings: sessionWarnings });
    });
    document.getElementById('draft-provider-select')?.addEventListener('change', (event) => {
      const target = event.target;
      const index = Number(target && target.value);
      const nickname = Number.isInteger(index) && index >= 0 && index < providerOptions.length
        ? String(providerOptions[index]?.nickname || '')
        : '';
      vscode.postMessage({ command: 'saveLastUsedProvider', nickname });
    });
    input.addEventListener('input', () => {
      resizeInput();
      updateTypeahead();
      updateSubmitButton();
    });
    input.addEventListener('paste', (event) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const files = Array.from(clipboard.files || []);
      if (!files.length) {
        for (const item of Array.from(clipboard.items || [])) {
          if (item.kind !== 'file') continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (!files.length) return;
      event.preventDefault();
      hideTypeahead();
      files.forEach(queuePastedFile);
    });
    input.addEventListener('click', updateTypeahead);
    input.addEventListener('keyup', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        updateTypeahead();
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        form.requestSubmit();
        return;
      }

      if (typeahead.hidden) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        hideTypeahead();
        return;
      }

      if (!completionSuggestions.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex + 1) % completionSuggestions.length;
        updateTypeaheadSelection();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex - 1 + completionSuggestions.length) % completionSuggestions.length;
        updateTypeaheadSelection();
        return;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        insertSelectedCompletion();
      }
    });
    resizeInput();
    if (${options.autoFocus ? "true" : "false"}) {
      requestAnimationFrame(() => input.focus());
    }
    requestAnimationFrame(scrollLastMessageTop);
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.command === 'addToInput') {
        addToInput(data.text || '');
        updateSubmitButton();
        return;
      }

      if (data.command === 'pastedAttachmentSaved') {
        const item = composerAttachments.find((candidate) => candidate.requestId === data.requestId);
        if (!item || discardedAttachmentRequests.has(data.requestId)) {
          if (data.attachment?.path) vscode.postMessage({ command: 'removePastedAttachment', attachment: data.attachment });
          return;
        }
        item.status = 'ready';
        item.attachment = data.attachment;
        renderComposerAttachments();
        return;
      }

      if (data.command === 'pastedAttachmentSaveError') {
        const item = composerAttachments.find((candidate) => candidate.requestId === data.requestId);
        if (!item || discardedAttachmentRequests.has(data.requestId)) return;
        item.status = 'error';
        item.error = String(data.error || 'Unable to save attachment.');
        renderComposerAttachments();
        return;
      }

      if (data.command === 'playNotificationSoundFallback') {
        playNotificationSoundInWebview();
        return;
      }

      if (data.command === 'sessionFileReady') {
        form.dataset.filePath = data.filePath || '';
        const shouldScroll = replaceMessages(
          Array.isArray(data.messages) ? data.messages : [],
        );
        updateContextUsage(data.contextUsage);
        updateSessionWarnings(data.warnings);
        updateUserInputWait(data.waitingForUser === true, data.waitingForUserMessage);
        if (shouldScroll) requestAnimationFrame(scrollLastMessageTop);
        return;
      }

      if (data.command === 'replaceMessages' && Array.isArray(data.messages)) {
        const shouldScroll = replaceMessages(data.messages);
        updateContextUsage(data.contextUsage);
        updateSessionWarnings(data.warnings);
        updateUserInputWait(data.waitingForUser === true, data.waitingForUserMessage);
        if (shouldScroll) requestAnimationFrame(scrollLastMessageTop);
        return;
      }

      if (data.command === 'fileSuggestions' || data.command === 'hashSuggestions') {
        if (data.requestId !== searchRequestId) return;
        completionSuggestions = Array.isArray(data.items) ? data.items : [];
        selectedSuggestionIndex = 0;
        renderTypeahead();
        return;
      }

      if (data.command !== 'appendMessages' || !Array.isArray(data.messages)) {
        return;
      }

      let shouldScroll = false;
      data.messages.forEach((message) => {
        shouldScroll = appendMessage(message) || shouldScroll;
      });
      if (shouldScroll) requestAnimationFrame(scrollLastMessageTop);
    });
    vscode.postMessage({ command: 'ready' });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const readyAttachments = getReadyAttachments();
      if (composerAttachments.some((item) => item.status === 'saving')) return;
      if (!input.value && !readyAttachments.length) return;

      const sentText = input.value;
      const clientMessageId = globalThis.crypto.randomUUID();
      const providerCliArgs = getSelectedProviderCliArgs();
      hideTypeahead();
      vscode.postMessage({
        command: 'sendMessage',
        filePath: form.dataset.filePath || '',
        text: sentText,
        attachments: readyAttachments,
        providerCliArgs,
        clientMessageId,
      });
      removeDraftProviderOptions();
      appendMessage({
        role: 'user',
        kind: 'message',
        text: sentText,
        attachments: readyAttachments,
        clientMessageId,
        deliveryState: 'pending',
      });
      appendMessage({
        role: 'thinking',
        kind: 'thinking',
        text: '',
        counts: {},
      });
      requestAnimationFrame(scrollLastMessageTop);
      input.value = '';
      composerAttachments.splice(0, composerAttachments.length);
      renderComposerAttachments();
      resizeInput();
      input.focus();
    });
  </script>
</body>
</html>`;
}

function getMessagePlaceholder(): string {
  return process.platform === "darwin"
    ? "Type message...⌘ Enter to send"
    : "Type message...Ctrl Enter to send";
}

function toScriptString(value: string): string {
  return toScriptJson(value);
}

function toScriptJson(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c");
}

function renderSessionDetailBody(
  session: SessionDetail,
  providerOptions: ProviderOption[],
  isDraftSession: boolean,
  lastUsedProviderNickname: string,
): string {
  if (session.error) {
    return `<div class="error">${escapeHtml(session.error)}</div>`;
  }

  if (!session.filePath) {
    return `${
      isDraftSession
        ? renderDraftProviderOptions(providerOptions, lastUsedProviderNickname)
        : ""
    }<div class="messages" id="messages"></div>`;
  }

  const messages = session.messages.length
    ? session.messages.map(renderSessionMessage).join("")
    : '<div class="empty-messages">No messages found in this session.</div>';

  return `<div class="messages" id="messages">${messages}</div>`;
}

function renderDraftProviderOptions(
  providerOptions: ProviderOption[],
  lastUsedProviderNickname: string,
): string {
  if (!providerOptions.length) {
    return `<div class="draft-provider-options" id="draft-provider-options"><div class="draft-provider-message">Pi will start with default settings, but you can change what model Pi uses by creating a provider setting in the settings page.</div></div>`;
  }

  const selectedIndex = providerOptions.findIndex(
    (option) => option.nickname === lastUsedProviderNickname,
  );
  const options = providerOptions
    .map((option, index) => {
      const selected = index === selectedIndex ? " selected" : "";
      return `<option value="${index}"${selected}>${escapeHtml(option.nickname)}</option>`;
    })
    .join("");
  const defaultSelected = selectedIndex === -1 ? " selected" : "";

  return `<div class="draft-provider-options" id="draft-provider-options"><label class="draft-provider-label" for="draft-provider-select">Provider</label><select class="draft-provider-select" id="draft-provider-select"><option value=""${defaultSelected}>Default Pi settings</option>${options}</select></div>`;
}
