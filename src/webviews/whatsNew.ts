import { escapeHtml } from "../utils";
import type { WhatsNewRelease } from "../whatsNew";

export const whatsNewStyles = `
  .whats-new-overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px;
    background: rgba(0, 0, 0, 0.45);
    background: color-mix(in srgb, var(--vscode-editor-background) 45%, transparent);
  }
  .whats-new-overlay[hidden] { display: none; }
  .whats-new {
    position: relative;
    width: min(100%, 360px);
    max-height: calc(100vh - 28px);
    overflow-y: auto;
    padding: 18px;
    color: var(--vscode-foreground);
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px;
    box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
  }
  .whats-new-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    padding: 0;
    color: var(--vscode-foreground);
    background: transparent;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 18px;
    line-height: 28px;
  }
  .whats-new-close:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }
  .whats-new h2 {
    margin: 3px 30px 3px 0;
    font-size: 18px;
    line-height: 1.25;
  }
  .whats-new-version {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  .whats-new-list {
    margin: 16px 0 18px;
    padding: 0;
    list-style: none;
  }
  .whats-new-item + .whats-new-item {
    margin-top: 14px;
  }
  .whats-new-item-title {
    margin-bottom: 3px;
    font-size: 12px;
    font-weight: 600;
  }
  .whats-new-item-description {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    line-height: 1.45;
  }
  .whats-new-dismiss {
    width: 100%;
    padding: 7px 12px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
  }
  .whats-new-dismiss:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .whats-new-close:focus-visible,
  .whats-new-dismiss:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: 2px;
  }
`;

export function renderWhatsNew(
  release?: WhatsNewRelease,
  hidden = false,
): string {
  if (!release) return "";

  return `
  <div class="whats-new-overlay" id="whats-new-overlay" data-version="${escapeHtml(release.version)}"${hidden ? " hidden" : ""}>
    <section class="whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <button type="button" class="whats-new-close" data-dismiss-whats-new aria-label="Dismiss What's new" title="Dismiss">&times;</button>
      <h2 id="whats-new-title">What's new</h2>
      <div class="whats-new-version">Version ${escapeHtml(release.version)}</div>
      <ul class="whats-new-list">
        ${release.items.map((item) => `
          <li class="whats-new-item">
            <div class="whats-new-item-title">${escapeHtml(item.title)}</div>
            <div class="whats-new-item-description">${escapeHtml(item.description)}</div>
          </li>`).join("")}
      </ul>
      <button type="button" class="whats-new-dismiss" id="whats-new-dismiss" data-dismiss-whats-new>Got it</button>
    </section>
  </div>`;
}
