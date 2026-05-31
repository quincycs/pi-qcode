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
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .settings { min-height: 100vh; display: flex; flex-direction: column; }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
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
  .body { padding: 12px; }
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
      <button type="button" class="home-button" id="home-button">Home</button>
      <div class="title">Settings</div>
    </header>
    <section class="body">
      <p class="description">Manage # autocomplete options. The command is what you type, and the value is inserted when selected.</p>
      <p class="path">Saved at ${escapeHtml(settingsFilePath)}</p>
      <div class="options" id="options"></div>
      <div class="actions">
        <button type="button" class="add-button" id="add-button">Add option</button>
      </div>
      <div class="status" id="status" aria-live="polite"></div>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const optionsContainer = document.getElementById('options');
    const status = document.getElementById('status');
    let options = ${toScriptJson(settings.hashAutocompleteOptions)};
    let editingIndex = -1;
    let editingIsNew = false;
    let draft = { command: '', value: '' };

    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.classList.toggle('error', isError);
    };
    const collectOptions = () => options.map((option) => ({
      command: String(option.command || '').trim(),
      value: String(option.value || ''),
    })).filter((option) => option.command && option.value);
    const persistOptions = () => {
      setStatus('Saving...');
      vscode.postMessage({
        command: 'saveSettings',
        settings: { hashAutocompleteOptions: collectOptions() },
      });
    };
    const beginEdit = (index, isNew = false) => {
      if (editingIndex !== -1 && editingIndex !== index && !confirm('Discard unsaved changes?')) return;
      editingIndex = index;
      editingIsNew = isNew;
      draft = {
        command: String(options[index]?.command || ''),
        value: String(options[index]?.value || ''),
      };
      renderOptions();
      const commandInput = optionsContainer.querySelector('[data-command-input]');
      if (commandInput) commandInput.focus();
    };
    const cancelEdit = () => {
      if (editingIsNew && editingIndex >= 0) {
        options.splice(editingIndex, 1);
      }
      editingIndex = -1;
      editingIsNew = false;
      draft = { command: '', value: '' };
      renderOptions();
      setStatus('');
    };
    const saveEdit = () => {
      if (editingIndex < 0) return;

      const command = String(draft.command || '').trim();
      const value = String(draft.value || '');
      if (!command || !value) {
        setStatus('Command and value are required.', true);
        return;
      }

      options[editingIndex] = { command, value };
      persistOptions();
    };
    const requestDeleteOption = (index) => {
      vscode.postMessage({
        command: 'confirmDeleteHashOption',
        index,
        label: options[index]?.command || 'this option',
      });
    };
    const deleteOption = (index) => {
      options.splice(index, 1);
      editingIndex = -1;
      editingIsNew = false;
      draft = { command: '', value: '' };
      persistOptions();
    };
    const renderDisplayRow = (option, index) => {
      const row = document.createElement('div');
      row.className = 'option-card option-display';

      const text = document.createElement('div');
      text.className = 'option-text';

      const title = document.createElement('div');
      title.className = 'option-title';
      title.textContent = option.command || '#';

      const subtitle = document.createElement('div');
      subtitle.className = 'option-subtitle';
      subtitle.textContent = option.value || '';

      text.append(title, subtitle);

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'edit-button';
      editButton.textContent = '✎';
      editButton.title = 'Edit';
      editButton.ariaLabel = 'Edit ' + (option.command || 'option');
      editButton.addEventListener('click', () => beginEdit(index));

      row.append(text, editButton);
      optionsContainer.append(row);
    };
    const renderEditRow = (index) => {
      const row = document.createElement('div');
      row.className = 'option-card option-edit';

      const fields = document.createElement('div');
      fields.className = 'edit-fields';

      const command = document.createElement('input');
      command.type = 'text';
      command.placeholder = '#c';
      command.ariaLabel = '# command';
      command.dataset.commandInput = 'true';
      command.value = draft.command;
      command.addEventListener('input', () => {
        draft.command = command.value;
        setStatus('Unsaved changes');
      });

      const value = document.createElement('textarea');
      value.rows = 5;
      value.placeholder = 'value to insert';
      value.ariaLabel = 'Inserted value';
      value.value = draft.value;
      value.addEventListener('input', () => {
        draft.value = value.value;
        setStatus('Unsaved changes');
      });

      fields.append(command, value);

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
      deleteButton.addEventListener('click', () => requestDeleteOption(index));

      actions.append(saveButton, cancelButton, deleteButton);
      row.append(fields, actions);


      optionsContainer.append(row);
    };
    const renderOptions = () => {
      optionsContainer.replaceChildren();
      if (!options.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No # autocomplete options configured.';
        optionsContainer.append(empty);
        return;
      }

      options.forEach((option, index) => {
        if (index === editingIndex) {
          renderEditRow(index);
        } else {
          renderDisplayRow(option, index);
        }
      });
    };

    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'home' });
    });
    document.getElementById('add-button').addEventListener('click', () => {
      if (editingIndex !== -1 && !confirm('Discard unsaved changes?')) return;
      options.push({ command: '#', value: '' });
      beginEdit(options.length - 1, true);
      setStatus('Unsaved changes');
    });
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.command === 'settingsSaved') {
        options = Array.isArray(data.settings && data.settings.hashAutocompleteOptions)
          ? data.settings.hashAutocompleteOptions
          : [];
        editingIndex = -1;
        editingIsNew = false;
        draft = { command: '', value: '' };
        renderOptions();
        setStatus('Saved');
        return;
      }

      if (data.command === 'settingsSaveError') {
        setStatus(data.error || 'Unable to save settings', true);
        return;
      }

      if (data.command === 'deleteHashOptionConfirmed') {
        deleteOption(Number(data.index));
      }
    });
    renderOptions();
  </script>
</body>
</html>`;
}

function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
