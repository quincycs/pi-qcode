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
  .home-button,
  .add-button,
  .save-button,
  .delete-button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
  }
  .home-button,
  .add-button,
  .save-button { padding: 4px 8px; }
  .delete-button { padding: 3px 7px; }
  .home-button:hover,
  .add-button:hover,
  .save-button:hover,
  .delete-button:hover { background: var(--vscode-button-hoverBackground); }
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
  .option-row {
    display: grid;
    grid-template-columns: minmax(72px, 0.8fr) minmax(110px, 1.4fr) auto;
    gap: 6px;
    align-items: center;
  }
  input {
    min-width: 0;
    padding: 4px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    font: inherit;
  }
  input:focus {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: -1px;
  }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
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
        <button type="button" class="save-button" id="save-button">Save</button>
      </div>
      <div class="status" id="status" aria-live="polite"></div>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const optionsContainer = document.getElementById('options');
    const status = document.getElementById('status');
    let options = ${toScriptJson(settings.hashAutocompleteOptions)};

    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.classList.toggle('error', isError);
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
        const row = document.createElement('div');
        row.className = 'option-row';

        const command = document.createElement('input');
        command.type = 'text';
        command.placeholder = '#c';
        command.ariaLabel = '# command';
        command.value = option.command || '';
        command.addEventListener('input', () => {
          options[index].command = command.value;
          setStatus('Unsaved changes');
        });

        const value = document.createElement('input');
        value.type = 'text';
        value.placeholder = 'continue';
        value.ariaLabel = 'Inserted value';
        value.value = option.value || '';
        value.addEventListener('input', () => {
          options[index].value = value.value;
          setStatus('Unsaved changes');
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'delete-button';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => {
          options.splice(index, 1);
          renderOptions();
          setStatus('Unsaved changes');
        });

        row.append(command, value, deleteButton);
        optionsContainer.append(row);
      });
    };
    const collectOptions = () => options.map((option) => ({
      command: String(option.command || '').trim(),
      value: String(option.value || ''),
    })).filter((option) => option.command && option.value);

    document.getElementById('home-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'home' });
    });
    document.getElementById('add-button').addEventListener('click', () => {
      options.push({ command: '#', value: '' });
      renderOptions();
      setStatus('Unsaved changes');
      const inputs = optionsContainer.querySelectorAll('input');
      const commandInput = inputs[inputs.length - 2];
      if (commandInput) commandInput.focus();
    });
    document.getElementById('save-button').addEventListener('click', () => {
      vscode.postMessage({
        command: 'saveSettings',
        settings: { hashAutocompleteOptions: collectOptions() },
      });
    });
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.command === 'settingsSaved') {
        options = Array.isArray(data.settings && data.settings.hashAutocompleteOptions)
          ? data.settings.hashAutocompleteOptions
          : [];
        renderOptions();
        setStatus('Saved');
        return;
      }

      if (data.command === 'settingsSaveError') {
        setStatus(data.error || 'Unable to save settings', true);
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
