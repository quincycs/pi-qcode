import type { RecentSession } from "../sessionFiles";
import { getRecentSessions } from "../sessionFiles";
import { escapeHtml } from "../utils";

export function renderHome(nonce: string, workspaceCwd?: string): string {
  const sessions = getRecentSessions(workspaceCwd);
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
    overflow: hidden;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .home {
    height: 100vh;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .header {
    padding: 14px 2px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, transparent);
  }
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .header-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
  }
  .new-session-button,
  .settings-button {
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 17px;
    padding: 4px 14px;
  }
  .new-session-button > span,
  .settings-button > span {
    position: relative;
    top: -1px;
  }
  .new-session-button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .settings-button {
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
  }
  .new-session-button:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .settings-button:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
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
  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    margin-right: -7px;
    padding: 4px 7px 12px 0;
  }
  .group-header {
    padding: 12px 2px 5px;
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
    padding: 8px 2px;
    color: inherit;
    background: transparent;
    border: 0;
    border-right: 2px solid transparent;
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
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    line-height: 1.35;
  }
  .preview {
    margin: 6px 0 0;
    padding: 5px 7px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-input-background);
    border-right: 2px solid var(--vscode-focusBorder, #007acc);
    border-radius: 3px;
    font-size: 10px;
    line-height: 1.35;
    word-break: break-word;
  }
  .empty {
    padding: 28px 8px;
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
      <div class="eyebrow">QCODE V0.0.16</div>
      <div class="header-row">
        <h1>Sessions</h1>
        <div class="header-actions">
          <button type="button" class="new-session-button" id="new-session-button"><span>+</span></button>
          <button type="button" class="settings-button" id="settings-button" aria-label="Settings" title="Settings"><span>⚙</span></button>
        </div>
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
    document.getElementById('settings-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'settings' });
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

function groupSessions(
  sessions: RecentSession[],
): Record<string, RecentSession[]> {
  return sessions.reduce<Record<string, RecentSession[]>>((groups, session) => {
    const group = dateGroup(session.lastActiveAt);
    groups[group] = groups[group] || [];
    groups[group].push(session);
    return groups;
  }, {});
}

function renderGroups(
  groups: Record<string, RecentSession[]>,
  total: number,
): string {
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
    timeSince(session.lastActiveAt),
    `${session.messageCount} msg${session.messageCount === 1 ? "" : "s"}`,
    session.model !== "unknown" ? session.model : "",
  ]
    .filter(Boolean)
    .join(" - ");

  return `
    <button type="button" class="session" title="${escapeHtml(session.fileName)}" data-open-session data-file-path="${escapeHtml(session.filePath)}">
      <div class="title-row">
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
