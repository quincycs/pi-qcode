const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const viewType = "qcode.home";

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(viewType, {
      resolveWebviewView(view) {
        view.webview.html = renderHome();
        view.onDidChangeVisibility(() => {
          if (view.visible) view.webview.html = renderHome();
        });
      },
    }),
  );
}

function renderHome() {
  const sessions = getRecentSessions();
  const groups = groupSessions(sessions);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
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
    margin: 0;
    padding: 8px 12px;
    border-left: 2px solid transparent;
  }
  .session:hover {
    background: var(--vscode-list-hoverBackground);
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
</body>
</html>`;
}

function getRecentSessions() {
  return getSessionFiles()
    .map(parseSessionFile)
    .filter(Boolean)
    .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
    .slice(0, 50);
}

function getSessionFiles() {
  const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
  const files = [];
  walk(sessionsDir, files);
  return files;
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
    <article class="session" title="${escapeHtml(session.fileName)}">
      <div class="title-row">
        <span class="dot"></span>
        <div class="title">${escapeHtml(session.title)}</div>
      </div>
      <div class="meta">${escapeHtml(meta)}</div>
      <div class="preview">${escapeHtml(session.preview)}</div>
    </article>`;
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
