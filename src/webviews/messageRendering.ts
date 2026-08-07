import type { SessionMessage } from "../sessionFiles";
import { escapeHtml } from "../utils";

export const messageRenderingStyles = String.raw`
  .message-text {
    margin: 0;
    word-break: break-word;
    overflow-wrap: anywhere;
    font: inherit;
    line-height: 1.45;
  }
  .message-text.plain-text {
    white-space: pre-wrap;
  }
  .message-text p,
  .message-text ul,
  .message-text blockquote,
  .message-text pre,
  .message-text table,
  .message-text h1,
  .message-text h2,
  .message-text h3,
  .message-text h4,
  .message-text h5,
  .message-text h6 {
    margin: 0 0 0.85em;
  }
  .message-text > :first-child {
    margin-top: 0;
  }
  .message-text > :last-child {
    margin-bottom: 0;
  }
  .message-text p {
    white-space: pre-wrap;
  }
  .message-text ul {
    padding-left: 1.7em;
  }
  .message-text blockquote {
    padding-left: 10px;
    color: var(--vscode-descriptionForeground);
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-widget-border, transparent));
  }
  .message-text .code-block {
    position: relative;
    margin: 0 0 0.85em;
  }
  .message-text .code-block:last-child {
    margin-bottom: 0;
  }
  .message-text .mermaid-block {
    min-width: 0;
  }
  .message-text .mermaid-output {
    max-width: 100%;
    overflow-x: auto;
    padding: 8px 0;
    text-align: center;
  }
  .message-text .mermaid-output[hidden],
  .message-text .mermaid-error[hidden] {
    display: none !important;
  }
  .message-text .mermaid-output svg {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
  .message-text .mermaid-block[data-mermaid-state="rendered"] .mermaid-source {
    display: none;
  }
  .message-text .mermaid-error {
    margin-top: 5px;
    color: var(--vscode-errorForeground);
    font-size: 11px;
  }
  .message-text pre {
    overflow-x: auto;
    padding: 10px;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    white-space: pre;
  }
  .message-text .code-block pre {
    margin: 0;
  }
  .code-block-copy-button {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    padding: 2px 7px;
    opacity: 0;
    pointer-events: none;
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    line-height: 18px;
  }
  .message-text .code-block:hover .code-block-copy-button,
  .code-block-copy-button:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .code-block-copy-button:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground, var(--vscode-button-background)));
  }
  .code-block-copy-button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: 1px;
  }
  .message-text code {
    padding: 0 3px;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 0.95em);
  }
  .message-text pre code {
    padding: 0;
    background: transparent;
    border-radius: 0;
    font-size: inherit;
  }
  .message-text table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    border-spacing: 0;
  }
  .message-text th,
  .message-text td {
    padding: 4px 8px;
    border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
    overflow-wrap: anywhere;
    word-break: break-word;
    text-align: left;
    vertical-align: top;
  }
  .message-text th {
    font-weight: 600;
    background: var(--vscode-editorWidget-background, transparent);
  }
  .message-text a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
  }
  .message-text a:hover {
    text-decoration: underline;
  }
  .message-text .file-reference {
    cursor: pointer;
  }
  .attachment-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 8px;
  }
  .attachment-list:first-child,
  .message-text[hidden] + .attachment-list {
    margin-top: 0;
  }
  .attachment-list[hidden] {
    display: none !important;
  }
  .attachment-row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 5px 7px;
    color: var(--vscode-foreground);
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
  }
  .attachment-icon {
    flex: 0 0 auto;
    font-size: 16px;
    line-height: 1;
  }
  .attachment-details {
    flex: 1 1 auto;
    min-width: 0;
  }
  .attachment-name,
  .attachment-meta {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attachment-name {
    font-size: 12px;
    font-weight: 600;
  }
  .attachment-meta {
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
  }
  .attachment-open,
  .attachment-remove {
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 3px;
    font: inherit;
  }
  .attachment-open {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-width: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .attachment-remove {
    flex: 0 0 auto;
    padding: 1px 5px;
    cursor: pointer;
    font-size: 16px;
    line-height: 18px;
  }
  .attachment-open:hover .attachment-name {
    color: var(--vscode-textLink-foreground);
    text-decoration: underline;
  }
  .attachment-remove:hover {
    background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
  }
  .attachment-row.is-error .attachment-meta {
    color: var(--vscode-errorForeground);
  }
  .qcode-context-menu[hidden] {
    display: none !important;
  }
  .qcode-context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 132px;
    padding: 4px;
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-input-background)));
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
    border-radius: 4px;
    box-shadow: 0 3px 8px rgb(0 0 0 / 28%);
  }
  .qcode-context-menu-button {
    display: block;
    width: 100%;
    padding: 5px 22px 5px 8px;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    line-height: 1.35;
    text-align: left;
    white-space: nowrap;
  }
  .qcode-context-menu-button:hover,
  .qcode-context-menu-button:focus {
    color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)));
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)));
    outline: none;
  }
`;

export const messageRenderingScript = String.raw`
    const qcodeMessageRendering = (() => {
      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      const escapeAttribute = escapeHtml;
      const commonFileExtensions = new Set([
        'astro', 'bash', 'c', 'cc', 'cfg', 'conf', 'cpp', 'cs', 'css', 'csv', 'cts', 'cxx', 'dart', 'env',
        'go', 'h', 'hpp', 'html', 'java', 'js', 'json', 'jsonc', 'jsx', 'kt', 'less', 'lock', 'lua', 'm',
        'md', 'mdx', 'mjs', 'mts', 'php', 'plist', 'ps1', 'py', 'rb', 'rs', 'sass', 'scss', 'sh', 'sql',
        'svelte', 'swift', 'toml', 'tsx', 'ts', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zig'
      ]);
      const fileReferencePattern = /@(?:"[^"\n]+"|'[^'\n]+'|[^\s\`<>()\[\]{}]+)|(?:\.{1,2}\/|\/|~\/)?[\w.@%+-]+(?:\/[\w.@%+-]+)+(?::\d+(?::\d+)?)?|[\w.-]+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?/g;
      const fileReferenceExistsCache = new Map();
      const pendingFileReferenceRequests = new Set();
      let fileReferenceRequestId = 0;
      let vscodeApi = null;
      let mermaidOptions = { scriptUri: '', nonce: '' };
      let mermaidLoadPromise = null;
      let mermaidRenderQueue = Promise.resolve();
      let mermaidRenderId = 0;
      let mermaidTheme = '';
      let mermaidThemeObserver = null;
      const trimTrailingFilePunctuation = (value) => {
        let text = value;
        let trailing = '';
        while (/[),.;!?]/.test(text.at(-1) || '')) {
          trailing = text.at(-1) + trailing;
          text = text.slice(0, -1);
        }
        return { text, trailing };
      };
      const cleanFileReference = (value) => {
        let text = String(value || '').trim();
        if (text.startsWith('@')) text = text.slice(1);
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
          text = text.slice(1, -1);
        }
        return text;
      };
      const getFileReferenceExtension = (value) => {
        const text = cleanFileReference(value)
          .replace(/#L\d+(?:C\d+)?$/i, '')
          .replace(/:\d+(?::\d+)?$/, '');
        const extensionMatch = text.match(/\.([A-Za-z0-9]{1,8})$/);
        return extensionMatch ? extensionMatch[1].toLowerCase() : '';
      };
      const looksLikeFileReference = (value) => {
        const text = cleanFileReference(value);
        if (!text || /^https?:\/\//i.test(text)) return false;
        const extension = getFileReferenceExtension(text);
        return Boolean(extension && commonFileExtensions.has(extension));
      };
      const isKnownExistingFileReference = (reference) => fileReferenceExistsCache.get(reference) === true;
      const queueFileReferenceCheck = (value) => {
        const reference = cleanFileReference(value);
        if (!reference || fileReferenceExistsCache.has(reference) || pendingFileReferenceRequests.has(reference)) return;
        pendingFileReferenceRequests.add(reference);
      };
      const collectFileReferences = (text) => {
        for (const match of String(text || '').matchAll(fileReferencePattern)) {
          const { text: referenceText } = trimTrailingFilePunctuation(match[0]);
          if (looksLikeFileReference(referenceText)) queueFileReferenceCheck(referenceText);
        }
      };
      const flushFileReferenceChecks = () => {
        if (!vscodeApi || pendingFileReferenceRequests.size === 0) return;
        const values = [...pendingFileReferenceRequests];
        pendingFileReferenceRequests.clear();
        vscodeApi.postMessage({
          command: 'resolveFileReferences',
          requestId: ++fileReferenceRequestId,
          values,
        });
      };
      const renderFileReferenceLink = (text) => {
        const reference = cleanFileReference(text);
        const display = text.startsWith('@') ? '@' + reference : reference;
        if (!isKnownExistingFileReference(reference)) return escapeHtml(display);
        return '<a href="#" class="file-reference" data-file-reference="' + escapeAttribute(reference) + '">' + escapeHtml(display) + '</a>';
      };
      const renderFormattedText = (text) => escapeHtml(text)
        .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n][\s\S]*?[^_\n])__/g, '<strong>$1</strong>');
      const renderPlainSegment = (segment) => {
        let html = '';
        let lastIndex = 0;
        for (const match of segment.matchAll(fileReferencePattern)) {
          const raw = match[0];
          const index = match.index || 0;
          const { text, trailing } = trimTrailingFilePunctuation(raw);
          if (!looksLikeFileReference(text)) continue;
          html += renderFormattedText(segment.slice(lastIndex, index));
          html += renderFileReferenceLink(text);
          html += renderFormattedText(trailing);
          lastIndex = index + raw.length;
        }
        html += renderFormattedText(segment.slice(lastIndex));
        return html;
      };
      const renderInlineMarkdown = (text) => {
        const tokenPattern = /\`([^\`]+)\`|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>)]+)/g;
        let html = '';
        let lastIndex = 0;
        for (const match of text.matchAll(tokenPattern)) {
          const index = match.index || 0;
          html += renderPlainSegment(text.slice(lastIndex, index));
          if (match[1] !== undefined) {
            const code = match[1];
            const fileReference = cleanFileReference(code);
            html += looksLikeFileReference(code) && isKnownExistingFileReference(fileReference)
              ? '<a href="#" class="file-reference" data-file-reference="' + escapeAttribute(fileReference) + '"><code>' + escapeHtml(code) + '</code></a>'
              : '<code>' + escapeHtml(code) + '</code>';
          } else if (match[2] !== undefined) {
            const label = match[2];
            const href = match[3];
            const fileReference = looksLikeFileReference(href) ? href : looksLikeFileReference(label) ? label : '';
            html += fileReference
              ? isKnownExistingFileReference(cleanFileReference(fileReference))
                ? '<a href="#" class="file-reference" data-file-reference="' + escapeAttribute(cleanFileReference(fileReference)) + '">' + renderFormattedText(label) + '</a>'
                : renderFormattedText(label)
              : '<a href="' + escapeAttribute(href) + '" data-external-url="' + escapeAttribute(href) + '">' + renderFormattedText(label) + '</a>';
          } else {
            const url = match[4];
            html += '<a href="' + escapeAttribute(url) + '" data-external-url="' + escapeAttribute(url) + '">' + escapeHtml(url) + '</a>';
          }
          lastIndex = index + match[0].length;
        }
        html += renderPlainSegment(text.slice(lastIndex));
        return html;
      };
      const renderListItems = (items) => '<ul>' + items.map((item) => '<li>' + renderInlineMarkdown(item) + '</li>').join('') + '</ul>';
      const renderMarkdown = (markdown) => {
        const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
        let html = '';
        let paragraph = [];
        let listItems = [];
        let inFence = false;
        let fenceLanguage = '';
        let fenceIndent = '';
        let codeLines = [];
        const flushParagraph = () => {
          if (!paragraph.length) return;
          html += '<p>' + renderInlineMarkdown(paragraph.join('\n')) + '</p>';
          paragraph = [];
        };
        const flushList = () => {
          if (!listItems.length) return;
          html += renderListItems(listItems);
          listItems = [];
        };
        const flushCode = () => {
          const languageClass = fenceLanguage ? ' class="language-' + escapeAttribute(fenceLanguage) + '"' : '';
          const escapedCode = escapeHtml(codeLines.join('\n'));
          const copyButton = '<button type="button" class="code-block-copy-button" aria-label="Copy code to clipboard" title="Copy code to clipboard">Copy</button>';
          if (fenceLanguage.toLowerCase() === 'mermaid') {
            html += '<div class="code-block mermaid-block" data-mermaid-state="pending">' + copyButton + '<div class="mermaid-output" hidden></div><pre class="mermaid-source"><code' + languageClass + '>' + escapedCode + '</code></pre><div class="mermaid-error" role="status" hidden>Unable to render Mermaid diagram. Source is shown instead.</div></div>';
          } else {
            html += '<div class="code-block">' + copyButton + '<pre><code' + languageClass + '>' + escapedCode + '</code></pre></div>';
          }
          codeLines = [];
          fenceLanguage = '';
          fenceIndent = '';
        };
        const parseTableRow = (line) => {
          const trimmed = String(line || '').trim();
          if (!trimmed.includes('|')) return null;
          const content = trimmed.replace(/^\|/, '').replace(/\|$/, '');
          const cells = [];
          let cell = '';
          let escaped = false;
          for (const character of content) {
            if (character === '|' && !escaped) {
              cells.push(cell.trim().replace(/\\\|/g, '|'));
              cell = '';
            } else {
              cell += character;
            }
            escaped = character === '\\' && !escaped;
          }
          cells.push(cell.trim().replace(/\\\|/g, '|'));
          return cells.length > 1 ? cells : null;
        };
        const isTableSeparator = (line) => {
          const cells = parseTableRow(line);
          return Boolean(cells && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim())));
        };
        const normalizeTableRow = (row, columnCount) => {
          const cells = row.slice(0, columnCount);
          while (cells.length < columnCount) cells.push('');
          return cells;
        };
        const renderTable = (header, rows) => {
          const columnCount = header.length;
          const headerHtml = normalizeTableRow(header, columnCount)
            .map((cell) => '<th>' + renderInlineMarkdown(cell) + '</th>')
            .join('');
          const bodyHtml = rows
            .map((row) => '<tr>' + normalizeTableRow(row, columnCount).map((cell) => '<td>' + renderInlineMarkdown(cell) + '</td>').join('') + '</tr>')
            .join('');
          return '<table><thead><tr>' + headerHtml + '</tr></thead>' + (bodyHtml ? '<tbody>' + bodyHtml + '</tbody>' : '') + '</table>';
        };
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          const fenceMatch = line.match(/^(\s*)\`\`\`\s*([^\`]*)$/);
          if (fenceMatch) {
            if (inFence) {
              flushCode();
              inFence = false;
            } else {
              flushParagraph();
              flushList();
              inFence = true;
              fenceIndent = fenceMatch[1] || '';
              fenceLanguage = fenceMatch[2].trim().split(/\s+/)[0] || '';
            }
            continue;
          }
          if (inFence) {
            codeLines.push(fenceIndent && line.startsWith(fenceIndent) ? line.slice(fenceIndent.length) : line);
            continue;
          }
          if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
          }
          const tableHeader = parseTableRow(line);
          if (tableHeader && isTableSeparator(lines[lineIndex + 1])) {
            const rows = [];
            flushParagraph();
            flushList();
            lineIndex += 2;
            while (lineIndex < lines.length) {
              const row = parseTableRow(lines[lineIndex]);
              if (!row || isTableSeparator(lines[lineIndex])) {
                lineIndex -= 1;
                break;
              }
              rows.push(row);
              lineIndex += 1;
            }
            html += renderTable(tableHeader, rows);
            continue;
          }
          const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
          if (headingMatch) {
            flushParagraph();
            flushList();
            const level = headingMatch[1].length;
            html += '<h' + level + '>' + renderInlineMarkdown(headingMatch[2]) + '</h' + level + '>';
            continue;
          }
          const unorderedMatch = line.match(/^\s*[-*+]\s+(.+)$/);
          if (unorderedMatch) {
            flushParagraph();
            listItems.push(unorderedMatch[1]);
            continue;
          }
          const quoteMatch = line.match(/^>\s?(.*)$/);
          if (quoteMatch) {
            flushParagraph();
            flushList();
            html += '<blockquote>' + renderInlineMarkdown(quoteMatch[1]) + '</blockquote>';
            continue;
          }
          if (listItems.length) flushList();
          paragraph.push(line);
        }
        if (inFence) flushCode();
        flushParagraph();
        flushList();
        return html;
      };
      const getMermaidTheme = () =>
        document.body.classList.contains('vscode-dark') ||
        document.body.classList.contains('vscode-high-contrast')
          ? 'dark'
          : 'default';
      const getMermaidThemeVariables = () => {
        const styles = getComputedStyle(document.body);
        const variables = { fontFamily: styles.fontFamily };
        const addColor = (name, vscodeVariable) => {
          const value = styles.getPropertyValue(vscodeVariable).trim();
          if (value) variables[name] = value;
        };
        addColor('primaryTextColor', '--vscode-foreground');
        addColor('secondaryTextColor', '--vscode-foreground');
        addColor('tertiaryTextColor', '--vscode-foreground');
        addColor('lineColor', '--vscode-descriptionForeground');
        addColor('primaryColor', '--vscode-editorWidget-background');
        addColor('secondaryColor', '--vscode-input-background');
        addColor('tertiaryColor', '--vscode-editor-background');
        addColor('primaryBorderColor', '--vscode-widget-border');
        return variables;
      };
      const initializeMermaid = (mermaid) => {
        const theme = getMermaidTheme();
        if (theme === mermaidTheme) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme,
          themeVariables: getMermaidThemeVariables(),
          maxTextSize: 50000,
          flowchart: { htmlLabels: false },
        });
        mermaidTheme = theme;
      };
      const loadMermaid = () => {
        if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid);
        if (mermaidLoadPromise) return mermaidLoadPromise;
        if (!mermaidOptions.scriptUri) {
          return Promise.reject(new Error('Mermaid renderer is unavailable.'));
        }

        mermaidLoadPromise = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = mermaidOptions.scriptUri;
          script.nonce = mermaidOptions.nonce;
          script.async = true;
          script.addEventListener('load', () => {
            if (globalThis.mermaid) resolve(globalThis.mermaid);
            else reject(new Error('Mermaid renderer did not initialize.'));
          }, { once: true });
          script.addEventListener('error', () => {
            reject(new Error('Unable to load Mermaid renderer.'));
          }, { once: true });
          document.head.append(script);
        });
        return mermaidLoadPromise;
      };
      const showMermaidFallback = (block) => {
        const output = block.querySelector('.mermaid-output');
        const error = block.querySelector('.mermaid-error');
        if (output) {
          output.replaceChildren();
          output.hidden = true;
        }
        if (error) error.hidden = false;
        block.dataset.mermaidState = 'error';
      };
      const queueMermaidBlock = (block) => {
        const source = block.querySelector('.mermaid-source code')?.textContent || '';
        const output = block.querySelector('.mermaid-output');
        const error = block.querySelector('.mermaid-error');
        if (!output || !source.trim()) {
          showMermaidFallback(block);
          return;
        }

        const attempt = ++mermaidRenderId;
        block.dataset.mermaidAttempt = String(attempt);
        block.dataset.mermaidState = 'pending';
        output.hidden = true;
        if (error) error.hidden = true;

        const render = async () => {
          if (!block.isConnected || block.dataset.mermaidAttempt !== String(attempt)) return;
          try {
            const mermaid = await loadMermaid();
            if (!block.isConnected || block.dataset.mermaidAttempt !== String(attempt)) return;
            initializeMermaid(mermaid);
            const result = await mermaid.render('qcode-mermaid-' + attempt, source);
            if (!block.isConnected || block.dataset.mermaidAttempt !== String(attempt)) return;
            output.innerHTML = result.svg;
            output.hidden = false;
            block.dataset.mermaidState = 'rendered';
            const svg = output.querySelector('svg');
            if (svg) {
              svg.setAttribute('role', 'img');
              svg.setAttribute('aria-label', 'Mermaid diagram');
            }
          } catch {
            if (block.isConnected && block.dataset.mermaidAttempt === String(attempt)) {
              showMermaidFallback(block);
            }
          }
        };
        const queuedRender = mermaidRenderQueue.then(render, render);
        mermaidRenderQueue = queuedRender.catch(() => {});
      };
      const renderMermaidDiagrams = (root) => {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        root.querySelectorAll('.mermaid-block').forEach(queueMermaidBlock);
      };
      const configureMermaid = (options = {}) => {
        mermaidOptions = {
          scriptUri: String(options.scriptUri || ''),
          nonce: String(options.nonce || ''),
        };
        if (mermaidThemeObserver) return;
        mermaidThemeObserver = new MutationObserver(() => {
          const nextTheme = getMermaidTheme();
          if (nextTheme === mermaidTheme) return;
          mermaidTheme = '';
          renderMermaidDiagrams(document);
        });
        mermaidThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      };
      const renderPlainText = (text) => renderPlainSegment(String(text || '')).replace(/\n/g, '<br>');
      const formatAttachmentSize = (value) => {
        const size = Number(value);
        if (!Number.isFinite(size) || size < 0) return '';
        if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';
        if (size >= 1024) return Math.round(size / 1024) + ' KB';
        return Math.round(size) + ' B';
      };
      const getAttachmentType = (attachment) => {
        const name = String(attachment?.name || '');
        return name.match(/\.([^.]+)$/)?.[1]?.toUpperCase() || 'FILE';
      };
      const createAttachmentRow = (attachment, options = {}) => {
        const row = document.createElement('div');
        row.className = 'attachment-row' + (options.error ? ' is-error' : '');
        const content = document.createElement(options.clickable && attachment?.path ? 'button' : 'div');
        if (content instanceof HTMLButtonElement) {
          content.type = 'button';
          content.className = 'attachment-open';
          content.dataset.fileReference = String(attachment.path || '');
          content.setAttribute('aria-label', 'Open attachment ' + String(attachment.name || 'file'));
        } else {
          content.className = 'attachment-open';
        }
        const icon = document.createElement('span');
        icon.className = 'attachment-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '▱';
        const details = document.createElement('span');
        details.className = 'attachment-details';
        const name = document.createElement('span');
        name.className = 'attachment-name';
        name.textContent = String(attachment?.name || 'pasted-file');
        const meta = document.createElement('span');
        meta.className = 'attachment-meta';
        const metadata = [getAttachmentType(attachment), formatAttachmentSize(attachment?.size)].filter(Boolean);
        meta.textContent = options.error || options.status || metadata.join(' · ');
        details.append(name, meta);
        content.append(icon, details);
        row.append(content);
        if (typeof options.onRemove === 'function') {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'attachment-remove';
          remove.textContent = '×';
          remove.setAttribute('aria-label', 'Remove attachment ' + String(attachment?.name || 'file'));
          remove.addEventListener('click', options.onRemove);
          row.append(remove);
        }
        return row;
      };
      const renderAttachmentList = (container, attachments, options = {}) => {
        container.replaceChildren();
        for (const attachment of Array.isArray(attachments) ? attachments : []) {
          container.append(createAttachmentRow(attachment, options));
        }
        container.hidden = !container.children.length;
      };
      const normalizeDisplayText = (message) => {
        let text = String((message && message.text) || '');
        if ((message && message.role) === 'user' && !/[\r\n]/.test(text) && /\\[rn]/.test(text)) {
          text = text.replace(/\\r\\n|\\n|\\r/g, '\n');
        }
        return text.replace(/\r\n?/g, '\n');
      };
      const renderMessageTextElement = (element, message) => {
        const rawText = String((message && message.text) || '');
        const text = normalizeDisplayText(message);
        collectFileReferences(text);
        const isMarkdown = message.kind !== 'thinking' && message.role !== 'user';
        element.className = 'message-text ' + (isMarkdown ? 'markdown-body' : 'plain-text');
        element.dataset.messageRole = message.role || '';
        element.dataset.messageKind = message.kind || 'message';
        element.dataset.messageText = rawText;
        element.innerHTML = isMarkdown ? renderMarkdown(text) : renderPlainText(text);
        if (isMarkdown) renderMermaidDiagrams(element);
        flushFileReferenceChecks();
      };
      const renderExistingMessages = () => {
        document.querySelectorAll('.message-text').forEach((element) => {
          renderMessageTextElement(element, {
            role: element.dataset.messageRole || '',
            kind: element.dataset.messageKind || 'message',
            text: element.dataset.messageText || element.textContent || '',
          });
        });
      };
      const getEventElement = (event) => {
        const target = event.target;
        if (target instanceof Element) return target;
        if (target instanceof Node) return target.parentElement;
        return null;
      };
      const getSelectedPageText = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return '';
        return selection.toString();
      };
      const getRawMessageText = (messageElement) => {
        const textElement = messageElement && messageElement.querySelector('.message-text');
        if (!textElement) return '';
        return textElement.dataset.messageText ?? textElement.textContent ?? '';
      };
      let contextMenuCopyText = '';
      const ensureContextMenu = (vscode) => {
        let menu = document.querySelector('.qcode-context-menu');
        if (menu) return menu;

        menu = document.createElement('div');
        menu.className = 'qcode-context-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qcode-context-menu-button';
        button.setAttribute('role', 'menuitem');
        button.addEventListener('click', () => {
          const text = contextMenuCopyText;
          contextMenuCopyText = '';
          menu.hidden = true;
          vscode.postMessage({ command: 'copyToClipboard', text });
        });

        menu.append(button);
        document.body.append(menu);
        return menu;
      };
      const showContextMenu = (vscode, label, text, clientX, clientY) => {
        const menu = ensureContextMenu(vscode);
        const button = menu.querySelector('.qcode-context-menu-button');
        button.textContent = label;
        contextMenuCopyText = String(text || '');
        menu.hidden = false;
        menu.style.left = clientX + 'px';
        menu.style.top = clientY + 'px';

        const rect = menu.getBoundingClientRect();
        const padding = 4;
        const left = Math.max(padding, Math.min(clientX, window.innerWidth - rect.width - padding));
        const top = Math.max(padding, Math.min(clientY, window.innerHeight - rect.height - padding));
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        button.focus();
      };
      const hideContextMenu = () => {
        const menu = document.querySelector('.qcode-context-menu');
        if (menu) menu.hidden = true;
      };
      const installClickHandlers = (vscode) => {
        vscodeApi = vscode;
        window.addEventListener('message', (event) => {
          const data = event.data;
          if (!data || data.command !== 'fileReferenceResolution' || !data.results) return;
          let changed = false;
          for (const [reference, exists] of Object.entries(data.results)) {
            const nextValue = Boolean(exists);
            if (fileReferenceExistsCache.get(reference) !== nextValue) changed = true;
            fileReferenceExistsCache.set(reference, nextValue);
          }
          if (changed) renderExistingMessages();
        });
        flushFileReferenceChecks();
        document.addEventListener('contextmenu', (event) => {
          const target = getEventElement(event);
          if (target && target.closest('.qcode-context-menu')) return;

          const selectedText = getSelectedPageText();
          if (selectedText) {
            event.preventDefault();
            showContextMenu(vscode, 'Copy', selectedText, event.clientX, event.clientY);
            return;
          }

          const messageElement = target && target.closest('.session-message');
          if (!messageElement) {
            hideContextMenu();
            return;
          }

          event.preventDefault();
          showContextMenu(vscode, 'Copy message', getRawMessageText(messageElement), event.clientX, event.clientY);
        });
        document.addEventListener('scroll', hideContextMenu, true);
        window.addEventListener('blur', hideContextMenu);
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') hideContextMenu();
        });
        document.addEventListener('click', (event) => {
          const target = getEventElement(event);
          if (!target || !target.closest('.qcode-context-menu')) hideContextMenu();

          const copyCodeButton = target && target.closest('.code-block-copy-button');
          if (copyCodeButton) {
            const code = copyCodeButton.closest('.code-block')?.querySelector('code');
            vscode.postMessage({ command: 'copyToClipboard', text: code?.textContent || '' });
            copyCodeButton.textContent = 'Copied';
            copyCodeButton.setAttribute('aria-label', 'Code copied to clipboard');
            copyCodeButton.setAttribute('title', 'Code copied to clipboard');
            window.setTimeout(() => {
              if (!copyCodeButton.isConnected) return;
              copyCodeButton.textContent = 'Copy';
              copyCodeButton.setAttribute('aria-label', 'Copy code to clipboard');
              copyCodeButton.setAttribute('title', 'Copy code to clipboard');
            }, 1500);
            return;
          }

          const fileReference = target && target.closest('[data-file-reference]');
          if (fileReference) {
            event.preventDefault();
            vscode.postMessage({
              command: 'openFileReference',
              value: fileReference.getAttribute('data-file-reference') || '',
            });
            return;
          }

          const externalLink = target && target.closest('a[data-external-url]');
          if (externalLink) {
            event.preventDefault();
            vscode.postMessage({
              command: 'openExternalUrl',
              value: externalLink.getAttribute('data-external-url') || '',
            });
          }
        });
      };

      return { configureMermaid, createAttachmentRow, renderAttachmentList, renderExistingMessages, renderMessageTextElement, installClickHandlers };
    })();
`;

function renderAttachmentRows(message: SessionMessage): string {
  if (!message.attachments?.length) return "";
  const rows = message.attachments.map((attachment) => {
    const type = pathExtension(attachment.name) || "FILE";
    const size = attachment.size === undefined ? "" : formatAttachmentSize(attachment.size);
    const metadata = [type, size].filter(Boolean).join(" · ");
    return `<div class="attachment-row"><button type="button" class="attachment-open" data-file-reference="${escapeHtml(attachment.path)}" aria-label="Open attachment ${escapeHtml(attachment.name)}"><span class="attachment-icon" aria-hidden="true">▱</span><span class="attachment-details"><span class="attachment-name">${escapeHtml(attachment.name)}</span><span class="attachment-meta">${escapeHtml(metadata)}</span></span></button></div>`;
  }).join("");
  return `<div class="attachment-list">${rows}</div>`;
}

function pathExtension(name: string): string {
  return name.match(/\.([^.]+)$/)?.[1]?.toUpperCase() || "";
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size)} B`;
}

export function renderSessionMessage(message: SessionMessage): string {
  const roleClass = message.kind === "thinking"
    ? "role-thinking"
    : message.role === "user"
      ? "role-user"
      : "role-assistant";
  const label = message.kind === "thinking"
    ? '<div class="thinking-label"><span>Thinking...</span><span class="thinking-elapsed"></span></div>'
    : "";
  const hiddenText = !message.text && message.attachments?.length ? " hidden" : "";
  return `<article class="session-message ${roleClass}">
    ${label}
    <div class="message-text" data-message-role="${escapeHtml(message.role)}" data-message-kind="${escapeHtml(message.kind ?? "message")}" data-message-text="${escapeHtml(message.text)}"${hiddenText}>${escapeHtml(message.text)}</div>
    ${renderAttachmentRows(message)}
  </article>`;
}
