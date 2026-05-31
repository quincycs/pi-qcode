import * as os from "node:os";
import type { RecentSession } from "../sessionFiles";
import { getRecentSessions } from "../sessionFiles";
import { escapeHtml } from "../utils";

export function renderHome(nonce: string): string {
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
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .new-session-button {
    flex: 0 0 auto;
    padding: 4px 8px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .new-session-button:hover {
    background: var(--vscode-button-hoverBackground);
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
      <div class="header-row">
        <h1>Recent Pi Sessions</h1>
        <button type="button" class="new-session-button" id="new-session-button">New</button>
      </div>
    </section>
    <section class="list">
      ${renderGroups(groups, sessions.length)}
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('new-session-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'newSession' });
    });
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

function groupSessions(sessions: RecentSession[]): Record<string, RecentSession[]> {
  return sessions.reduce<Record<string, RecentSession[]>>((groups, session) => {
    const group = dateGroup(session.createdAt);
    groups[group] = groups[group] || [];
    groups[group].push(session);
    return groups;
  }, {});
}

function renderGroups(groups: Record<string, RecentSession[]>, total: number): string {
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

function renderSession(session: RecentSession): string {
  const meta = [
    session.model !== "unknown" ? session.model : "",
    `${session.messageCount} msg${session.messageCount === 1 ? "" : "s"}`,
    timeSince(session.lastActiveAt),
    session.totalTokens > 0 ? `${Math.round(session.totalTokens / 1000)}k tok` : "",
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

function dateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "This Week";
  return "Older";
}

function timeSince(date: Date): string {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortPath(value: string): string {
  const home = os.homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}
