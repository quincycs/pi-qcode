const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const viewType = "qcode.home";

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(viewType, {
      resolveWebviewView(view) {
        let currentRoute = { name: "home" };

        view.webview.options = { enableScripts: true };

        const showHome = () => {
          currentRoute = { name: "home" };
          view.webview.html = renderHome(getNonce());
        };

        const showSessionDetail = (filePath) => {
          currentRoute = { name: "sessionDetail", filePath };
          view.webview.html = renderSessionDetail(filePath, getNonce());
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
        });

        view.onDidChangeVisibility(() => {
          if (!view.visible) return;

          if (currentRoute.name === "sessionDetail") {
            showSessionDetail(currentRoute.filePath);
          } else {
            showHome();
          }
        });
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

function renderSessionDetail(filePath, nonce) {
  const session = readSessionDetail(filePath);

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
  .card {
    padding: 12px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 5px;
  }
  .label {
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .line-count {
    margin-top: 6px;
    font-size: 26px;
    font-weight: 700;
  }
  .path {
    margin-top: 8px;
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    line-height: 1.4;
    word-break: break-all;
  }
  .error {
    color: var(--vscode-errorForeground);
    line-height: 1.45;
  }
  .footer {
    flex: 0 0 auto;
    display: flex;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid var(--vscode-widget-border, transparent);
  }
  .message-input {
    min-width: 0;
    flex: 1 1 auto;
    padding: 4px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    font: inherit;
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
    <form class="footer" id="message-form">
      <input class="message-input" type="text" aria-label="Message" placeholder="Message" />
      <button class="submit-button" type="submit" aria-label="Submit">➤</button>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'home' });
    });
    document.getElementById('message-form').addEventListener('submit', (event) => {
      event.preventDefault();
    });
  </script>
</body>
</html>`;
}

function renderSessionDetailBody(session) {
  if (session.error) {
    return `<div class="error">${escapeHtml(session.error)}</div>`;
  }

  return `<div class="card">
    <div class="label">Lines in session file</div>
    <div class="line-count">${session.lineCount}</div>
    <div class="path">${escapeHtml(session.filePath)}</div>
  </div>`;
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
      lineCount: countLines(content),
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

function readText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const block = content.find((item) => item && item.type === "text");
  return block && typeof block.text === "string" ? block.text : "";
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
