const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const viewType = "qcode.home";

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(viewType, {
      resolveWebviewView(view) {
        let currentRoute = { name: "home" };
        let sessionWatcher;
        const messageSessions = new Map();

        view.webview.options = { enableScripts: true };

        const stopSessionWatcher = () => {
          if (!sessionWatcher) return;
          sessionWatcher.dispose();
          sessionWatcher = undefined;
        };

        const showHome = () => {
          stopSessionWatcher();
          currentRoute = { name: "home" };
          view.webview.html = renderHome(getNonce());
        };

        const showSessionDetail = (filePath) => {
          stopSessionWatcher();
          const session = readSessionDetail(filePath);
          currentRoute = { name: "sessionDetail", filePath };
          view.webview.html = renderSessionDetail(filePath, getNonce(), session);
          sessionWatcher = watchSessionDetail(session, view.webview);
        };

        showHome();

        view.webview.onDidReceiveMessage((message) => {
          if (!message || typeof message.command !== "string") return;

          if (message.command === "openSession") {
            showSessionDetail(String(message.filePath || ""));
          }

          if (message.command === "home") {
            showHome();
          }

          if (message.command === "sendMessage") {
            sendSessionMessage(
              messageSessions,
              String(message.filePath || ""),
              String(message.text || ""),
            );
          }
        });

        view.onDidChangeVisibility(() => {
          if (!view.visible) return;

          if (currentRoute.name === "sessionDetail") {
            showSessionDetail(currentRoute.filePath);
          } else {
            showHome();
          }
        });

        context.subscriptions.push({ dispose: stopSessionWatcher });
      },
    }),
  );
}

function renderHome(nonce) {
  const sessions = getRecentSessions();
  const groups = groupSessions(sessions);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'none';">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .home {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    padding: 14px 12px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, transparent);
  }
  .eyebrow {
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 {
    margin: 4px 0 0;
    font-size: 16px;
    font-weight: 600;
  }
  .list { padding: 4px 0 12px; }
  .group-header {
    padding: 12px 12px 5px;
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .session {
    display: block;
    width: 100%;
    margin: 0;
    padding: 8px 12px;
    color: inherit;
    background: transparent;
    border: 0;
    border-left: 2px solid transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .session:hover,
  .session:focus-visible {
    background: var(--vscode-list-hoverBackground);
  }
  .session:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: -1px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .dot {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--vscode-charts-blue, #3794ff);
    opacity: 0.9;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }
  .meta {
    margin-top: 3px;
    padding-left: 14px;
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    line-height: 1.35;
  }
  .preview {
    margin: 6px 0 0 14px;
    padding: 5px 7px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-input-background);
    border-left: 2px solid var(--vscode-focusBorder, #007acc);
    border-radius: 3px;
    font-size: 10px;
    line-height: 1.35;
    word-break: break-word;
  }
  .empty {
    padding: 28px 18px;
    color: var(--vscode-descriptionForeground);
    text-align: center;
    font-size: 12px;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <main class="home">
    <section class="header">
      <div class="eyebrow">Home</div>
      <h1>Recent Pi Sessions</h1>
    </section>
    <section class="list">
      ${renderGroups(groups, sessions.length)}
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-open-session]').forEach((session) => {
      session.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openSession',
          filePath: session.dataset.filePath || '',
        });
      });
    });
  </script>
</body>
</html>`;
}

function renderSessionDetail(filePath, nonce, session) {
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

function renderSessionDetailBody(session) {
  if (session.error) {
    return `<div class="error">${escapeHtml(session.error)}</div>`;
  }

  const messages = session.messages.length
    ? session.messages.map(renderSessionMessage).join("")
    : '<div class="empty-messages">No messages found in this session.</div>';

  return `<div class="messages" id="messages">${messages}</div>`;
}

function renderSessionMessage(message) {
  return `<article class="session-message">
    <div class="message-role">${escapeHtml(message.role)}</div>
    <pre class="message-text">${escapeHtml(message.text)}</pre>
  </article>`;
}

function watchSessionDetail(session, webview) {
  if (session.error || !session.filePath || !fs.existsSync(session.filePath)) {
    return undefined;
  }

  return createSessionFileWatcher(session.filePath, session.fileSize, (messages) => {
    if (!messages.length) return;
    webview.postMessage({ command: "appendMessages", messages });
  });
}

function createSessionFileWatcher(filePath, startPosition, onMessages) {
  let disposed = false;
  let offset = startPosition;
  let pendingText = "";

  const readAppendedLines = () => {
    if (disposed) return;

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    if (stat.size < offset) {
      offset = stat.size;
      pendingText = "";
    }

    if (stat.size === offset) return;

    let fd;
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buffer, 0, length, offset);
      offset = stat.size;

      const text = pendingText + buffer.toString("utf8");
      const lines = text.split(/\r\n|\r|\n/);
      pendingText = /\r\n$|\r$|\n$/.test(text) ? "" : lines.pop() || "";

      const messages = lines.map(readSessionMessageLine).filter(Boolean);
      onMessages(messages);
    } catch {
      // Ignore transient reads while the session file is being appended.
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors.
        }
      }
    }
  };

  let readTimer;
  const scheduleRead = () => {
    if (readTimer) return;
    readTimer = setTimeout(() => {
      readTimer = undefined;
      readAppendedLines();
    }, 50);
  };

  let watcher;
  try {
    watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
      if (eventType === "change") scheduleRead();
    });
  } catch {
    return undefined;
  }

  scheduleRead();

  return {
    dispose() {
      disposed = true;
      if (readTimer) clearTimeout(readTimer);
      watcher.close();
    },
  };
}

function sendSessionMessage(messageSessions, filePath, text) {
  if (!text) return;

  if (!isSessionFile(filePath)) {
    vscode.window.showErrorMessage(
      "Unable to send message: invalid session file.",
    );
    return;
  }

  const resolvedFilePath = path.resolve(filePath);
  const existingMessageSession = messageSessions.get(resolvedFilePath);
  if (existingMessageSession) {
    sendSocketMessage(existingMessageSession.guid, {
      type: "text",
      from: "qcode",
      text,
    });
    return;
  }

  const guid = crypto.randomUUID();
  const terminal = createSessionTerminal();
  messageSessions.set(resolvedFilePath, { guid, terminal });

  terminal.show();
  terminal.sendText(buildSessionMessageCommand(resolvedFilePath, guid, text));
}

function sendSocketMessage(target, message) {
  return new Promise((resolve) => {
    const socket = net.createConnection(getMsgSocketPath(target));
    let reply = "";

    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(reply);
    });

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
      socket.end();
    });

    socket.on("data", (chunk) => {
      reply += chunk.toString();
    });

    socket.on("end", () => resolve(reply));
    socket.on("error", () => resolve(""));
  });
}

function getMsgSocketPath(name) {
  return path.join(os.homedir(), ".pi", "msg", `${name}.sock`);
}

function createSessionTerminal() {
  const cwd = getWorkspaceCwd();
  return vscode.window.createTerminal({
    name: "QCode Session Message",
    ...(cwd ? { cwd } : {}),
  });
}

function getWorkspaceCwd() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  return workspaceFolder ? workspaceFolder.uri.fsPath : undefined;
}

function buildSessionMessageCommand(sessionFilePath, guid, message) {
  const encodedMessage = message
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\n");

  return [
    "pi",
    "--session",
    shellEscape(sessionFilePath),
    shellEscape(`/msg-on ${guid}`),
    shellEscape(encodedMessage),
  ].join(" ");
}

function shellEscape(value) {
  const text = String(value);
  if (!text) return "''";
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function readSessionDetail(filePath) {
  if (!filePath) {
    return {
      title: "Session Detail",
      error: "No session file was provided.",
    };
  }

  if (!isSessionFile(filePath)) {
    return {
      title: "Session Detail",
      error: "The requested session file is not valid.",
    };
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return {
      title: path.basename(filePath),
      filePath,
      fileSize: Buffer.byteLength(content, "utf8"),
      messages: readSessionMessages(content),
    };
  } catch {
    return {
      title: path.basename(filePath),
      error: "Unable to read the requested session file.",
    };
  }
}

function getRecentSessions() {
  return getSessionFiles()
    .map(parseSessionFile)
    .filter(Boolean)
    .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
    .slice(0, 50);
}

function getSessionFiles() {
  const files = [];
  walk(getSessionsDir(), files);
  return files;
}

function getSessionsDir() {
  return path.join(os.homedir(), ".pi", "agent", "sessions");
}

function walk(dir, files) {
  if (!fs.existsSync(dir)) return;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl"))
      files.push(fullPath);
  }
}

function parseSessionFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line.trim());

    let id = path.basename(filePath);
    let cwd = "";
    let model = "unknown";
    let messageCount = 0;
    let firstUserMessage = "";
    let totalTokens = 0;
    let createdAt = stat.birthtime;
    let lastActiveAt = stat.mtime;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const timestamp = entry.timestamp
          ? new Date(entry.timestamp)
          : undefined;
        if (timestamp && !Number.isNaN(timestamp.getTime())) {
          if (timestamp < createdAt) createdAt = timestamp;
          if (timestamp > lastActiveAt) lastActiveAt = timestamp;
        }

        if (entry.type === "session") {
          id = String(entry.id || id);
          cwd = String(entry.cwd || cwd);
          if (timestamp) createdAt = timestamp;
        }

        if (
          entry.type === "model_change" &&
          entry.modelId &&
          model === "unknown"
        ) {
          model = String(entry.modelId);
        }

        if (entry.type === "message" && entry.message) {
          if (entry.message.role === "user" && !firstUserMessage) {
            const text = readText(entry.message.content);
            if (text && !text.startsWith("You are running inside VS Code")) {
              firstUserMessage = text.slice(0, 160).replace(/\s+/g, " ").trim();
            }
          }

          if (entry.message.role === "assistant") {
            messageCount += 1;
            if (entry.usage && Number(entry.usage.totalTokens)) {
              totalTokens += Number(entry.usage.totalTokens);
            }
          }
        }
      } catch {
        // Ignore malformed JSONL rows.
      }
    }

    return {
      id,
      cwd,
      model,
      messageCount,
      totalTokens,
      filePath,
      fileName: path.basename(filePath),
      title: firstUserMessage || path.basename(filePath),
      preview: firstUserMessage || "(no messages yet)",
      createdAt,
      lastActiveAt,
    };
  } catch {
    return null;
  }
}

function readSessionMessages(content) {
  return content
    .split(/\r\n|\r|\n/)
    .map(readSessionMessageLine)
    .filter(Boolean);
}

function readSessionMessageLine(line) {
  if (!line.trim()) return null;

  try {
    const entry = JSON.parse(line);
    if (entry.type !== "message" || !entry.message) return null;

    const text = readText(entry.message.content);
    if (!text) return null;

    return {
      role: String(entry.message.role || "message"),
      text,
    };
  } catch {
    return null;
  }
}

function readText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function groupSessions(sessions) {
  return sessions.reduce((groups, session) => {
    const group = dateGroup(session.createdAt);
    groups[group] = groups[group] || [];
    groups[group].push(session);
    return groups;
  }, {});
}

function renderGroups(groups, total) {
  if (!total) {
    return '<div class="empty">No Pi sessions found.<br>Start Pi to create one.</div>';
  }

  return ["Today", "Yesterday", "This Week", "Older"]
    .filter((group) => groups[group] && groups[group].length)
    .map(
      (group) => `
      <div class="group-header">${group}</div>
      ${groups[group].map(renderSession).join("")}
    `,
    )
    .join("");
}

function renderSession(session) {
  const meta = [
    session.model !== "unknown" ? session.model : "",
    `${session.messageCount} msg${session.messageCount === 1 ? "" : "s"}`,
    timeSince(session.lastActiveAt),
    session.totalTokens > 0
      ? `${Math.round(session.totalTokens / 1000)}k tok`
      : "",
    session.cwd ? shortPath(session.cwd) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <button type="button" class="session" title="${escapeHtml(session.fileName)}" data-open-session data-file-path="${escapeHtml(session.filePath)}">
      <div class="title-row">
        <span class="dot"></span>
        <div class="title">${escapeHtml(session.title)}</div>
      </div>
      <div class="meta">${escapeHtml(meta)}</div>
      <div class="preview">${escapeHtml(session.preview)}</div>
    </button>`;
}

function dateGroup(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "This Week";
  return "Older";
}

function timeSince(date) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 60_000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortPath(value) {
  const home = os.homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function countLines(content) {
  if (!content) return 0;

  const lineBreaks = content.match(/\r\n|\r|\n/g) || [];
  const endsWithLineBreak = /\r\n$|\r$|\n$/.test(content);
  return lineBreaks.length + (endsWithLineBreak ? 0 : 1);
}

function isSessionFile(filePath) {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedSessionsDir = path.resolve(getSessionsDir());
  return (
    resolvedFilePath.startsWith(`${resolvedSessionsDir}${path.sep}`) &&
    resolvedFilePath.endsWith(".jsonl")
  );
}

function getNonce() {
  return `${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function deactivate() {}

module.exports = { activate, deactivate };
