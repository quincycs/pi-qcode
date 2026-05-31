import type { SessionDetail, SessionMessage } from "../sessionFiles";
import { escapeHtml } from "../utils";

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
    padding: 10px 12px;
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
    padding: 4px 8px;
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
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 16px 12px;
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
  .message-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font: inherit;
    line-height: 1.45;
  }
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
    flex: 0 0 auto;
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 8px;
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
</style>
</head>
<body>
  <main class="detail">
    <header class="header">
      <button type="button" class="home-button" id="home-button">Home</button>
      <div class="title" id="session-title">${escapeHtml(session.title)}</div>
    </header>
    <section class="body">
      ${renderSessionDetailBody(session)}
    </section>
    <form class="footer" id="message-form" data-file-path="${escapeHtml(filePath)}">
      <textarea class="message-input" id="message-input" rows="1" aria-label="Message" placeholder="Message"></textarea>
      <button class="submit-button" id="submit-button" type="submit" aria-label="Submit">➤</button>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('message-form');
    const input = document.getElementById('message-input');
    const title = document.getElementById('session-title');
    const messages = document.getElementById('messages');
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

      const text = document.createElement('pre');
      text.className = 'message-text';
      text.textContent = message.text || '';

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
    const addToInput = (text) => {
      if (!text) return;
      input.value = input.value ? input.value + String.fromCharCode(10) + text : text;
      resizeInput();
      input.focus();
    };
    const initialInput = ${toScriptString(options.initialInput ?? "")};
    if (initialInput) addToInput(initialInput);

    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'home' });
    });
    input.addEventListener('input', resizeInput);
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
        if (title) title.textContent = data.title || 'Session Detail';
        replaceMessages(Array.isArray(data.messages) ? data.messages : []);
        requestAnimationFrame(scrollLastMessageTop);
        return;
      }

      if (data.command === 'replaceMessages' && Array.isArray(data.messages)) {
        replaceMessages(data.messages);
        requestAnimationFrame(scrollLastMessageTop);
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

function toScriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
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

function renderSessionMessage(message: SessionMessage): string {
  const roleClass = message.kind === "thinking"
    ? "role-thinking"
    : message.role === "user"
      ? "role-user"
      : "role-assistant";
  const label = message.kind === "thinking" ? '<div class="thinking-label">Thinking...</div>' : "";
  return `<article class="session-message ${roleClass}">
    ${label}
    <pre class="message-text">${escapeHtml(message.text)}</pre>
  </article>`;
}
