import type { SessionDetail, SessionMessage } from "../sessionFiles";
import { escapeHtml } from "../utils";

export function renderSessionDetail(filePath: string, nonce: string, session: SessionDetail): string {
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
    border-radius: 5px;
  }
  .message-role {
    margin-bottom: 6px;
    color: var(--vscode-descriptionForeground);
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
      <div class="title">${escapeHtml(session.title)}</div>
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
    const appendMessage = (message) => {
      if (!messages) return;

      const empty = messages.querySelector('.empty-messages');
      if (empty) empty.remove();

      const article = document.createElement('article');
      article.className = 'session-message';

      const role = document.createElement('div');
      role.className = 'message-role';
      role.textContent = message.role || 'message';

      const text = document.createElement('pre');
      text.className = 'message-text';
      text.textContent = message.text || '';

      article.append(role, text);
      messages.append(article);
    };

    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'home' });
    });
    input.addEventListener('input', resizeInput);
    resizeInput();
    requestAnimationFrame(scrollLastMessageTop);
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.command !== 'appendMessages' || !Array.isArray(data.messages)) {
        return;
      }

      data.messages.forEach(appendMessage);
      requestAnimationFrame(scrollLastMessageTop);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!input.value) return;

      vscode.postMessage({
        command: 'sendMessage',
        filePath: form.dataset.filePath || '',
        text: input.value,
      });
      input.value = '';
      resizeInput();
      input.focus();
    });
  </script>
</body>
</html>`;
}

function renderSessionDetailBody(session: SessionDetail): string {
  if (session.error) {
    return `<div class="error">${escapeHtml(session.error)}</div>`;
  }

  const messages = session.messages.length
    ? session.messages.map(renderSessionMessage).join("")
    : '<div class="empty-messages">No messages found in this session.</div>';

  return `<div class="messages" id="messages">${messages}</div>`;
}

function renderSessionMessage(message: SessionMessage): string {
  return `<article class="session-message">
    <div class="message-role">${escapeHtml(message.role)}</div>
    <pre class="message-text">${escapeHtml(message.text)}</pre>
  </article>`;
}
