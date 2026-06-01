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
  options: { autoFocus?: boolean; initialInput?: string } = {},
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'none';">
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
  .thinking-label {
    margin-bottom: 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
${messageRenderingStyles}
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
    align-items: flex-end;
    gap: 6px;
    padding: 3px 0;
    border-top: 1px solid var(--vscode-widget-border, transparent);
  }
  .message-input {
    min-width: 0;
    min-height: 26px;
    max-height: calc(1.35em * 10 + 10px);
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
  .typeahead-item:hover,
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
      <div class="context-usage" id="context-usage" aria-label="Context window usage" title="Context usage unavailable">—</div>
    </header>
    <section class="body">
      ${renderSessionDetailBody(session)}
    </section>
    <form class="footer" id="message-form" data-file-path="${escapeHtml(filePath)}">
      <div class="typeahead" id="typeahead" role="listbox" aria-label="Autocomplete suggestions" hidden>
        <div class="typeahead-list" id="typeahead-list"></div>
      </div>
      <textarea class="message-input" id="message-input" rows="1" aria-label="Message" placeholder="${escapeHtml(getMessagePlaceholder())}"></textarea>
      <button class="submit-button" id="submit-button" type="submit" aria-label="Submit">➤</button>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('message-form');
    const input = document.getElementById('message-input');
    const messages = document.getElementById('messages');
    const contextUsage = document.getElementById('context-usage');
    const typeahead = document.getElementById('typeahead');
    const typeaheadList = document.getElementById('typeahead-list');
    let completionState = null;
    let completionSuggestions = [];
    let selectedSuggestionIndex = 0;
    let searchRequestId = 0;
    let searchTimer = undefined;

    const resizeInput = () => {
      input.style.height = 'auto';
      const maxHeight = Number.parseFloat(getComputedStyle(input).maxHeight);
      input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
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
${messageRenderingScript}
    const appendMessage = (message) => {
      if (!messages) return;

      const empty = messages.querySelector('.empty-messages');
      if (empty) empty.remove();

      const lastMessage = messages.querySelector('.session-message:last-child');
      if (lastMessage && lastMessage.classList.contains('role-thinking')) {
        lastMessage.remove();
      }

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
        label.textContent = 'Thinking...';
        article.append(label);
      }

      const text = document.createElement('div');
      qcodeMessageRendering.renderMessageTextElement(text, message);

      article.append(text);
      messages.append(article);
    };
    const replaceMessages = (newMessages) => {
      if (!messages) return;
      messages.replaceChildren();
      if (!newMessages.length) {
        renderEmptyMessages();
        return;
      }
      newMessages.forEach(appendMessage);
    };
    const formatTokens = (value) => {
      const numberValue = Number(value || 0);
      if (!Number.isFinite(numberValue) || numberValue <= 0) return '0';
      if (numberValue >= 1000000) return (numberValue / 1000000).toFixed(numberValue >= 10000000 ? 0 : 1) + 'M';
      if (numberValue >= 1000) return (numberValue / 1000).toFixed(numberValue >= 10000 ? 0 : 1) + 'K';
      return String(Math.round(numberValue));
    };
    const formatCost = (value) => {
      const numberValue = Number(value || 0);
      if (!Number.isFinite(numberValue) || numberValue <= 0) return '';
      return '$' + numberValue.toFixed(numberValue < 0.01 ? 4 : numberValue < 1 ? 3 : 2);
    };
    const updateContextUsage = (usage) => {
      if (!contextUsage) return;

      const used = Number(usage && usage.usedTokens);
      const total = Number(usage && usage.contextWindow);
      const rawPercent = Number.isFinite(used) && used >= 0 && Number.isFinite(total) && total > 0
        ? (used / total) * 100
        : NaN;
      const hasPercent = Number.isFinite(rawPercent);

      const details = [];
      if (usage && usage.modelId) details.push(usage.modelId);
      if (usage && usage.thinkingLevel) details.push('reasoning ' + usage.thinkingLevel);
      const cost = formatCost(usage && usage.sessionCost);
      if (cost) details.push(cost);
      const detailText = details.join(' · ');
      const detailSuffix = detailText ? ' · ' + detailText : '';

      if (hasPercent) {
        const title = 'Context window used: ' + rawPercent.toFixed(1) + '% (' + formatTokens(used) + ' / ' + formatTokens(total) + ' tokens' + detailSuffix + ')';
        const percentElement = document.createElement('span');
        percentElement.className = 'context-usage-value';
        percentElement.textContent = rawPercent.toFixed(1) + '%';
        contextUsage.replaceChildren(percentElement);
        if (cost) {
          const costElement = document.createElement('span');
          costElement.className = 'context-usage-value';
          costElement.textContent = cost;
          contextUsage.append(costElement);
        }
        contextUsage.title = title;
        contextUsage.setAttribute('aria-valuetext', title);
      } else {
        const title = 'Context usage unavailable' + (detailText ? ' (' + detailText + ')' : '') + '. Waiting for assistant token usage and context window metadata.';
        contextUsage.textContent = '—';
        contextUsage.title = title;
        contextUsage.setAttribute('aria-valuetext', title);
      }
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
        button.addEventListener('mouseenter', () => {
          selectedSuggestionIndex = index;
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
      input.focus();
    };
    const initialInput = ${toScriptString(options.initialInput ?? "")};
    qcodeMessageRendering.installClickHandlers(vscode);
    qcodeMessageRendering.renderExistingMessages();
    updateContextUsage(${toScriptJson(session.contextUsage)});
    if (initialInput) addToInput(initialInput);

    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'home' });
    });
    input.addEventListener('input', () => {
      resizeInput();
      updateTypeahead();
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
        renderTypeahead();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex - 1 + completionSuggestions.length) % completionSuggestions.length;
        renderTypeahead();
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
        return;
      }

      if (data.command === 'sessionFileReady') {
        form.dataset.filePath = data.filePath || '';
        replaceMessages(Array.isArray(data.messages) ? data.messages : []);
        updateContextUsage(data.contextUsage);
        requestAnimationFrame(scrollLastMessageTop);
        return;
      }

      if (data.command === 'replaceMessages' && Array.isArray(data.messages)) {
        replaceMessages(data.messages);
        updateContextUsage(data.contextUsage);
        requestAnimationFrame(scrollLastMessageTop);
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

      data.messages.forEach(appendMessage);
      requestAnimationFrame(scrollLastMessageTop);
    });
    vscode.postMessage({ command: 'ready' });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!input.value) return;

      const sentText = input.value;
      hideTypeahead();
      vscode.postMessage({
        command: 'sendMessage',
        filePath: form.dataset.filePath || '',
        text: sentText,
      });
      appendMessage({ role: 'user', kind: 'message', text: sentText });
      requestAnimationFrame(scrollLastMessageTop);
      input.value = '';
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

function renderSessionDetailBody(session: SessionDetail): string {
  if (session.error) {
    return `<div class="error">${escapeHtml(session.error)}</div>`;
  }

  if (!session.filePath) {
    return '<div class="messages" id="messages"></div>';
  }

  const messages = session.messages.length
    ? session.messages.map(renderSessionMessage).join("")
    : '<div class="empty-messages">No messages found in this session.</div>';

  return `<div class="messages" id="messages">${messages}</div>`;
}

