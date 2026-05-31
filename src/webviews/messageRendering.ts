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
  .message-text ol,
  .message-text blockquote,
  .message-text pre,
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
  .message-text ul,
  .message-text ol {
    padding-left: 1.7em;
  }
  .message-text blockquote {
    padding-left: 10px;
    color: var(--vscode-descriptionForeground);
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-widget-border, transparent));
  }
  .message-text pre {
    overflow-x: auto;
    padding: 10px;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px;
    white-space: pre;
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
        .replace(/__([^_\n][\s\S]*?[^_\n])__/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/_([^_\n]+)_/g, '<em>$1</em>');
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
      const renderListItems = (items, tag) => '<' + tag + '>' + items.map((item) => '<li>' + renderInlineMarkdown(item) + '</li>').join('') + '</' + tag + '>';
      const renderMarkdown = (markdown) => {
        const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
        let html = '';
        let paragraph = [];
        let listItems = [];
        let listTag = '';
        let inFence = false;
        let fenceLanguage = '';
        let codeLines = [];
        const flushParagraph = () => {
          if (!paragraph.length) return;
          html += '<p>' + renderInlineMarkdown(paragraph.join('\n')) + '</p>';
          paragraph = [];
        };
        const flushList = () => {
          if (!listItems.length) return;
          html += renderListItems(listItems, listTag || 'ul');
          listItems = [];
          listTag = '';
        };
        const flushCode = () => {
          const languageClass = fenceLanguage ? ' class="language-' + escapeAttribute(fenceLanguage) + '"' : '';
          html += '<pre><code' + languageClass + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>';
          codeLines = [];
          fenceLanguage = '';
        };
        for (const line of lines) {
          const fenceMatch = line.match(/^\`\`\`\s*([^\`]*)$/);
          if (fenceMatch) {
            if (inFence) {
              flushCode();
              inFence = false;
            } else {
              flushParagraph();
              flushList();
              inFence = true;
              fenceLanguage = fenceMatch[1].trim().split(/\s+/)[0] || '';
            }
            continue;
          }
          if (inFence) {
            codeLines.push(line);
            continue;
          }
          if (!line.trim()) {
            flushParagraph();
            flushList();
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
          const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
          if (unorderedMatch || orderedMatch) {
            flushParagraph();
            const nextTag = unorderedMatch ? 'ul' : 'ol';
            if (listTag && listTag !== nextTag) flushList();
            listTag = nextTag;
            listItems.push((unorderedMatch || orderedMatch)[1]);
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
      const renderPlainText = (text) => renderPlainSegment(String(text || '')).replace(/\n/g, '<br>');
      const renderMessageTextElement = (element, message) => {
        const text = message.text || '';
        collectFileReferences(text);
        const isMarkdown = message.kind !== 'thinking' && message.role !== 'user';
        element.className = 'message-text ' + (isMarkdown ? 'markdown-body' : 'plain-text');
        element.dataset.messageRole = message.role || '';
        element.dataset.messageKind = message.kind || 'message';
        element.dataset.messageText = text;
        element.innerHTML = isMarkdown ? renderMarkdown(text) : renderPlainText(text);
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
        document.addEventListener('click', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          const fileReference = target && target.closest('a[data-file-reference]');
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

      return { renderExistingMessages, renderMessageTextElement, installClickHandlers };
    })();
`;

export function renderSessionMessage(message: SessionMessage): string {
  const roleClass = message.kind === "thinking"
    ? "role-thinking"
    : message.role === "user"
      ? "role-user"
      : "role-assistant";
  const label = message.kind === "thinking" ? '<div class="thinking-label">Thinking...</div>' : "";
  return `<article class="session-message ${roleClass}">
    ${label}
    <div class="message-text" data-message-role="${escapeHtml(message.role)}" data-message-kind="${escapeHtml(message.kind ?? "message")}">${escapeHtml(message.text)}</div>
  </article>`;
}
