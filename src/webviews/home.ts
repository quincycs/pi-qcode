import type { RecentSession } from "../sessionFiles";
import { getRecentSessions } from "../sessionFiles";
import { getSessionPinnedAt } from "../sessionPins";
import { escapeHtml } from "../utils";
import type { WhatsNewRelease } from "../whatsNew";
import { renderWhatsNew, whatsNewStyles } from "./whatsNew";

export function renderHome(
  nonce: string,
  workspaceCwd: string | undefined,
  version: string,
  whatsNew?: WhatsNewRelease,
  pinnedSessions: ReadonlyMap<string, number> = new Map(),
): string {
  const sessions = getRecentSessions(workspaceCwd, [...pinnedSessions.keys()]);
  const groups = groupSessions(sessions, pinnedSessions);

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
  .context-menu {
    position: fixed;
    z-index: 20;
    min-width: 120px;
    padding: 4px;
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
    border-radius: 4px;
    box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
  }
  .context-menu[hidden] { display: none; }
  .context-menu-item {
    display: block;
    width: 100%;
    padding: 5px 18px;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 2px;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .context-menu-item:hover,
  .context-menu-item:focus-visible {
    color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
    outline: none;
  }
${whatsNewStyles}
</style>
</head>
<body>
  <main class="home" id="home"${whatsNew ? " inert" : ""}>
    <section class="header">
      <div class="eyebrow">QCODE V${escapeHtml(version)}</div>
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
  <div class="context-menu" id="session-context-menu" role="menu" hidden>
    <button type="button" class="context-menu-item" id="session-pin-action" role="menuitem">Pin</button>
  </div>
  ${renderWhatsNew(whatsNew)}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('new-session-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'newSession' });
    });
    document.getElementById('settings-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'settings' });
    });

    const whatsNewOverlay = document.getElementById('whats-new-overlay');
    const dismissWhatsNew = () => {
      if (!whatsNewOverlay || !whatsNewOverlay.isConnected) return;
      whatsNewOverlay.remove();
      document.getElementById('home').removeAttribute('inert');
      vscode.postMessage({
        command: 'dismissWhatsNew',
        version: whatsNewOverlay.dataset.version || '',
      });
    };
    document.querySelectorAll('[data-dismiss-whats-new]').forEach((button) => {
      button.addEventListener('click', dismissWhatsNew);
    });
    if (whatsNewOverlay) {
      document.getElementById('whats-new-dismiss').focus();
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') dismissWhatsNew();
      });
    }

    const sessionContextMenu = document.getElementById('session-context-menu');
    const sessionPinAction = document.getElementById('session-pin-action');
    let contextSession = null;

    const closeSessionContextMenu = () => {
      sessionContextMenu.hidden = true;
      contextSession = null;
    };
    const openSessionContextMenu = (event, session) => {
      event.preventDefault();
      contextSession = session;
      sessionPinAction.textContent = session.dataset.pinned === 'true' ? 'Unpin' : 'Pin';
      sessionContextMenu.hidden = false;
      const bounds = sessionContextMenu.getBoundingClientRect();
      sessionContextMenu.style.left = Math.max(4, Math.min(event.clientX, window.innerWidth - bounds.width - 4)) + 'px';
      sessionContextMenu.style.top = Math.max(4, Math.min(event.clientY, window.innerHeight - bounds.height - 4)) + 'px';
      sessionPinAction.focus();
    };

    document.querySelectorAll('[data-open-session]').forEach((session) => {
      session.addEventListener('click', () => {
        closeSessionContextMenu();
        vscode.postMessage({
          command: 'openSession',
          filePath: session.dataset.filePath || '',
        });
      });
      session.addEventListener('contextmenu', (event) => {
        openSessionContextMenu(event, session);
      });
    });
    sessionPinAction.addEventListener('click', () => {
      if (!contextSession) return;
      vscode.postMessage({
        command: 'setSessionPinned',
        filePath: contextSession.dataset.filePath || '',
        pinned: contextSession.dataset.pinned !== 'true',
      });
      closeSessionContextMenu();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!sessionContextMenu.hidden && !sessionContextMenu.contains(event.target)) {
        closeSessionContextMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !sessionContextMenu.hidden) {
        closeSessionContextMenu();
      }
    });
    window.addEventListener('blur', closeSessionContextMenu);
    document.querySelector('.list').addEventListener('scroll', closeSessionContextMenu);
  </script>
</body>
</html>`;
}

export function groupSessions(
  sessions: RecentSession[],
  pinnedSessions: ReadonlyMap<string, number> = new Map(),
): Record<string, RecentSession[]> {
  const orderedSessions = [...sessions].sort((a, b) => {
    const aPinnedAt = getSessionPinnedAt(pinnedSessions, a.filePath);
    const bPinnedAt = getSessionPinnedAt(pinnedSessions, b.filePath);
    if (aPinnedAt !== undefined && bPinnedAt !== undefined) {
      return bPinnedAt - aPinnedAt;
    }
    if (aPinnedAt !== undefined) return -1;
    if (bPinnedAt !== undefined) return 1;
    return b.lastActiveAt.getTime() - a.lastActiveAt.getTime();
  });

  return orderedSessions.reduce<Record<string, RecentSession[]>>(
    (groups, session) => {
      const group = getSessionPinnedAt(pinnedSessions, session.filePath) !== undefined
        ? "Pinned"
        : dateGroup(session.lastActiveAt);
      groups[group] = groups[group] || [];
      groups[group].push(session);
      return groups;
    },
    {},
  );
}

function renderGroups(
  groups: Record<string, RecentSession[]>,
  total: number,
): string {
  if (!total) {
    return '<div class="empty">No Pi sessions found.<br>Start Pi to create one.</div>';
  }

  return ["Pinned", "Today", "Yesterday", "This Week", "Older"]
    .filter((group) => groups[group] && groups[group].length)
    .map(
      (group) => `
      <div class="group-header">${group}</div>
      ${groups[group]
        .map((session) => renderSession(session, group === "Pinned"))
        .join("")}
    `,
    )
    .join("");
}

function renderSession(session: RecentSession, pinned: boolean): string {
  const meta = [
    timeSince(session.lastActiveAt),
    `${session.messageCount} msg${session.messageCount === 1 ? "" : "s"}`,
    session.model !== "unknown" ? session.model : "",
  ]
    .filter(Boolean)
    .join(" - ");

  return `
    <button type="button" class="session" title="${escapeHtml(session.fileName)}" data-open-session data-file-path="${escapeHtml(session.filePath)}" data-pinned="${pinned}">
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
