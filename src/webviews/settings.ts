import type { QcodeSettings } from "../qcodeSettings";
import { escapeHtml } from "../utils";

export function renderSettings(
  nonce: string,
  settings: QcodeSettings,
  settingsFilePath: string,
): string {
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
  .settings {
    height: 100vh;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 2px;
    border-bottom: 1px solid var(--vscode-widget-border, transparent);
  }
  button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .home-button,
  .add-button,
  .save-button,
  .cancel-button,
  .delete-button { padding: 4px 8px; }
  .home-button {
    padding: 2px 8px;
    font-size: 18px;
    line-height: 1;
  }
  .edit-button {
    width: 26px;
    height: 24px;
    flex: 0 0 auto;
    padding: 0;
  }
  .delete-button {
    color: var(--vscode-errorForeground, var(--vscode-button-foreground));
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  }
  .title { font-size: 13px; font-weight: 600; }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    margin-right: -7px;
    padding: 12px 9px 12px 2px;
  }
  .settings-section { margin-top: 16px; }
  .settings-section:first-of-type { margin-top: 0; }
  .section-title {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 700;
  }
  .description {
    margin: 0 0 12px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.4;
  }
  .path {
    margin: 0 0 12px;
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    word-break: break-all;
  }
  .options { display: flex; flex-direction: column; gap: 8px; }
  .option-card {
    padding: 9px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 5px;
  }
  .option-display {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .option-text { min-width: 0; flex: 1 1 auto; }
  .option-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 700;
  }
  .option-subtitle {
    margin-top: 4px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .edit-fields {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  input,
  textarea {
    width: 100%;
    min-width: 0;
    padding: 5px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    font: inherit;
    line-height: 1.35;
  }
  textarea {
    min-height: 90px;
    resize: vertical;
  }
  input:focus,
  textarea:focus {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: -1px;
  }
  .row-actions,
  .actions { display: flex; gap: 8px; }
  .row-actions { margin-top: 8px; flex-wrap: wrap; }
  .actions { margin-top: 12px; }
  .status {
    min-height: 1.4em;
    margin-top: 10px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.4;
  }
  .status.error { color: var(--vscode-errorForeground); }
  .empty {
    padding: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-input-background);
    border: 1px dashed var(--vscode-widget-border, transparent);
    border-radius: 4px;
    text-align: center;
  }
</style>
</head>
<body>
  <main class="settings">
    <header class="header">
      <button type="button" class="home-button" id="home-button" aria-label="Home" title="Home">←</button>
      <div class="title">Settings</div>
    </header>
    <section class="body">
      <p class="path">Saved at ${escapeHtml(settingsFilePath)}</p>

      <section class="settings-section" aria-labelledby="provider-options-title">
        <h2 class="section-title" id="provider-options-title">Provider Options</h2>
        <div class="options" id="provider-options"></div>
        <div class="actions">
          <button type="button" class="add-button" id="add-provider-button">Add provider</button>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="command-options-title">
        <h2 class="section-title" id="command-options-title">Command Options</h2>
        <p class="description">Manage # autocomplete options. The command is what you type, and the value is inserted when selected.</p>
        <div class="options" id="hash-options"></div>
        <div class="actions">
          <button type="button" class="add-button" id="add-hash-button">Add option</button>
        </div>
      </section>

      <div class="status" id="status" aria-live="polite"></div>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const providerOptionsContainer = document.getElementById('provider-options');
    const hashOptionsContainer = document.getElementById('hash-options');
    const status = document.getElementById('status');
    let providerOptions = ${toScriptJson(settings.providerOptions)};
    let hashOptions = ${toScriptJson(settings.hashAutocompleteOptions)};
    let lastUsedProviderNickname = ${toScriptJson(settings.lastUsedProviderNickname)};
    let editing = null;
    let providerDraft = { nickname: '', cliArgs: '' };
    let hashDraft = { command: '', value: '' };

    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.classList.toggle('error', isError);
    };
    const resetDrafts = () => {
      providerDraft = { nickname: '', cliArgs: '' };
      hashDraft = { command: '', value: '' };
    };
    const discardPendingEdit = () => {
      if (!editing) return true;
      if (!confirm('Discard unsaved changes?')) return false;

      if (editing.isNew && editing.index >= 0) {
        if (editing.kind === 'provider') {
          providerOptions.splice(editing.index, 1);
        } else {
          hashOptions.splice(editing.index, 1);
        }
      }

      editing = null;
      resetDrafts();
      return true;
    };
    const collectProviderOptions = () => providerOptions.map((option) => ({
      nickname: String(option.nickname || '').trim(),
      cliArgs: String(option.cliArgs || '').trim(),
    })).filter((option) => option.nickname && option.cliArgs);
    const collectHashOptions = () => hashOptions.map((option) => ({
      command: String(option.command || '').trim(),
      value: String(option.value || ''),
    })).filter((option) => option.command && option.value);
    const persistSettings = () => {
      setStatus('Saving...');
      vscode.postMessage({
        command: 'saveSettings',
        settings: {
          providerOptions: collectProviderOptions(),
          hashAutocompleteOptions: collectHashOptions(),
          lastUsedProviderNickname,
        },
      });
    };
    const focusFirstEditInput = (kind) => {
      const container = kind === 'provider' ? providerOptionsContainer : hashOptionsContainer;
      const input = container.querySelector(kind === 'provider' ? '[data-nickname-input]' : '[data-command-input]');
      if (input) input.focus();
    };
    const beginProviderEdit = (index, isNew = false) => {
      if (editing && (editing.kind !== 'provider' || editing.index !== index) && !discardPendingEdit()) return;
      if (isNew) index = providerOptions.length - 1;
      editing = { kind: 'provider', index, isNew };
      providerDraft = {
        nickname: String(providerOptions[index]?.nickname || ''),
        cliArgs: String(providerOptions[index]?.cliArgs || ''),
      };
      renderAll();
      focusFirstEditInput('provider');
    };
    const beginHashEdit = (index, isNew = false) => {
      if (editing && (editing.kind !== 'hash' || editing.index !== index) && !discardPendingEdit()) return;
      if (isNew) index = hashOptions.length - 1;
      editing = { kind: 'hash', index, isNew };
      hashDraft = {
        command: String(hashOptions[index]?.command || ''),
        value: String(hashOptions[index]?.value || ''),
      };
      renderAll();
      focusFirstEditInput('hash');
    };
    const cancelEdit = () => {
      if (editing?.isNew && editing.index >= 0) {
        if (editing.kind === 'provider') {
          providerOptions.splice(editing.index, 1);
        } else {
          hashOptions.splice(editing.index, 1);
        }
      }
      editing = null;
      resetDrafts();
      renderAll();
      setStatus('');
    };
    const saveEdit = () => {
      if (!editing) return;

      if (editing.kind === 'provider') {
        const nickname = String(providerDraft.nickname || '').trim();
        const cliArgs = String(providerDraft.cliArgs || '').trim();
        if (!nickname || !cliArgs) {
          setStatus('Provider nickname and Pi CLI args are required.', true);
          return;
        }

        providerOptions[editing.index] = { nickname, cliArgs };
      } else {
        const command = String(hashDraft.command || '').trim();
        const value = String(hashDraft.value || '');
        if (!command || !value) {
          setStatus('Command and value are required.', true);
          return;
        }

        hashOptions[editing.index] = { command, value };
      }

      persistSettings();
    };
    const requestDeleteProviderOption = (index) => {
      vscode.postMessage({
        command: 'confirmDeleteProviderOption',
        index,
        label: providerOptions[index]?.nickname || 'this provider',
      });
    };
    const requestDeleteHashOption = (index) => {
      vscode.postMessage({
        command: 'confirmDeleteHashOption',
        index,
        label: hashOptions[index]?.command || 'this option',
      });
    };
    const deleteProviderOption = (index) => {
      providerOptions.splice(index, 1);
      editing = null;
      resetDrafts();
      persistSettings();
    };
    const deleteHashOption = (index) => {
      hashOptions.splice(index, 1);
      editing = null;
      resetDrafts();
      persistSettings();
    };
    const renderDisplayRow = (container, titleText, subtitleText, editLabel, onEdit) => {
      const row = document.createElement('div');
      row.className = 'option-card option-display';

      const text = document.createElement('div');
      text.className = 'option-text';

      const title = document.createElement('div');
      title.className = 'option-title';
      title.textContent = titleText;

      const subtitle = document.createElement('div');
      subtitle.className = 'option-subtitle';
      subtitle.textContent = subtitleText;

      text.append(title, subtitle);

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'edit-button';
      editButton.textContent = '✎';
      editButton.title = 'Edit';
      editButton.ariaLabel = editLabel;
      editButton.addEventListener('click', onEdit);

      row.append(text, editButton);
      container.append(row);
    };
    const appendEditActions = (row, onDelete) => {
      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'save-button';
      saveButton.textContent = 'Save';
      saveButton.addEventListener('click', saveEdit);

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'cancel-button';
      cancelButton.textContent = 'Cancel';
      cancelButton.addEventListener('click', cancelEdit);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', onDelete);

      actions.append(saveButton, cancelButton, deleteButton);
      row.append(actions);
    };
    const renderProviderEditRow = (index) => {
      const row = document.createElement('div');
      row.className = 'option-card option-edit';

      const fields = document.createElement('div');
      fields.className = 'edit-fields';

      const nickname = document.createElement('input');
      nickname.type = 'text';
      nickname.placeholder = 'Provider nickname';
      nickname.ariaLabel = 'Provider nickname';
      nickname.dataset.nicknameInput = 'true';
      nickname.value = providerDraft.nickname;
      nickname.addEventListener('input', () => {
        providerDraft.nickname = nickname.value;
        setStatus('Unsaved changes');
      });

      const cliArgs = document.createElement('input');
      cliArgs.type = 'text';
      cliArgs.placeholder = '--model openai-codex/gpt-5.5';
      cliArgs.ariaLabel = 'Pi CLI args';
      cliArgs.value = providerDraft.cliArgs;
      cliArgs.addEventListener('input', () => {
        providerDraft.cliArgs = cliArgs.value;
        setStatus('Unsaved changes');
      });

      fields.append(nickname, cliArgs);
      row.append(fields);
      appendEditActions(row, () => requestDeleteProviderOption(index));
      providerOptionsContainer.append(row);
    };
    const renderHashEditRow = (index) => {
      const row = document.createElement('div');
      row.className = 'option-card option-edit';

      const fields = document.createElement('div');
      fields.className = 'edit-fields';

      const command = document.createElement('input');
      command.type = 'text';
      command.placeholder = '#c';
      command.ariaLabel = '# command';
      command.dataset.commandInput = 'true';
      command.value = hashDraft.command;
      command.addEventListener('input', () => {
        hashDraft.command = command.value;
        setStatus('Unsaved changes');
      });

      const value = document.createElement('textarea');
      value.rows = 5;
      value.placeholder = 'value to insert';
      value.ariaLabel = 'Inserted value';
      value.value = hashDraft.value;
      value.addEventListener('input', () => {
        hashDraft.value = value.value;
        setStatus('Unsaved changes');
      });

      fields.append(command, value);
      row.append(fields);
      appendEditActions(row, () => requestDeleteHashOption(index));
      hashOptionsContainer.append(row);
    };
    const renderProviderOptions = () => {
      providerOptionsContainer.replaceChildren();
      if (!providerOptions.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No provider options configured.';
        providerOptionsContainer.append(empty);
        return;
      }

      providerOptions.forEach((option, index) => {
        if (editing?.kind === 'provider' && editing.index === index) {
          renderProviderEditRow(index);
        } else {
          const nickname = option.nickname || 'Provider';
          renderDisplayRow(
            providerOptionsContainer,
            nickname,
            option.cliArgs || '',
            'Edit ' + nickname,
            () => beginProviderEdit(index),
          );
        }
      });
    };
    const renderHashOptions = () => {
      hashOptionsContainer.replaceChildren();
      if (!hashOptions.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No # autocomplete options configured.';
        hashOptionsContainer.append(empty);
        return;
      }

      hashOptions.forEach((option, index) => {
        if (editing?.kind === 'hash' && editing.index === index) {
          renderHashEditRow(index);
        } else {
          const command = option.command || '#';
          renderDisplayRow(
            hashOptionsContainer,
            command,
            option.value || '',
            'Edit ' + command,
            () => beginHashEdit(index),
          );
        }
      });
    };
    const renderAll = () => {
      renderProviderOptions();
      renderHashOptions();
    };

    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'home' });
    });
    document.getElementById('add-provider-button').addEventListener('click', () => {
      if (!discardPendingEdit()) return;
      providerOptions.push({ nickname: '', cliArgs: '' });
      beginProviderEdit(providerOptions.length - 1, true);
      setStatus('Unsaved changes');
    });
    document.getElementById('add-hash-button').addEventListener('click', () => {
      if (!discardPendingEdit()) return;
      hashOptions.push({ command: '#', value: '' });
      beginHashEdit(hashOptions.length - 1, true);
      setStatus('Unsaved changes');
    });
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.command === 'settingsSaved') {
        providerOptions = Array.isArray(data.settings && data.settings.providerOptions)
          ? data.settings.providerOptions
          : [];
        hashOptions = Array.isArray(data.settings && data.settings.hashAutocompleteOptions)
          ? data.settings.hashAutocompleteOptions
          : [];
        lastUsedProviderNickname = typeof (data.settings && data.settings.lastUsedProviderNickname) === 'string'
          ? data.settings.lastUsedProviderNickname
          : '';
        editing = null;
        resetDrafts();
        renderAll();
        setStatus('Saved');
        return;
      }

      if (data.command === 'settingsSaveError') {
        setStatus(data.error || 'Unable to save settings', true);
        return;
      }

      if (data.command === 'deleteProviderOptionConfirmed') {
        deleteProviderOption(Number(data.index));
        return;
      }

      if (data.command === 'deleteHashOptionConfirmed') {
        deleteHashOption(Number(data.index));
      }
    });
    renderAll();
  </script>
</body>
</html>`;
}

function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
