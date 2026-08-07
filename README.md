# pi-qcode

Native vscode extension for pi coding agent. Uses pi cli within vscode terminal to power the vsextension behind the scenes while rendering rich UI in the native extension. No additional Pi extensions are required. Qcode explicitly loads its bundled bridge extension into every Pi terminal it creates.

The design is meant to be a chill version of the pi experience, but you can immediately jump to the full Pi experience at any time you want. qcode UI supresses the noisy messages and only shows the final turn messages + user messages. Go to the active vscode terminal to go back to the full pi experience.

If you like it, consider a [donation](http://venmo.com/quincycs).

Demo below. Scroll to the bottom for more screenshots and video.

https://github.com/user-attachments/assets/d4b264ce-1b24-4532-8c6b-93db5f4052b9

## Main Features

- Powered by Pi inside vscode terminal, so you can jump into the full experience anytime.
- UI only shows the final turn messages + user messages, suppressing the noisy messages.
- Thinking... indicator shows summary of what's happening (eg skills activated, and counts of tool calls).
- "Enter" key is a new line, encouraging you to slowdown and think before sending. Use `cmd+enter` (mac) or `ctrl+enter` (windows/linux) to send.
- "Add to pi-qcode" is a context menu option to add highlighted code in the editor into a draft message to send to pi. This menu is also available in the vscode terminal. Hotkey: `cmd+;` (mac) or `ctrl+;` (windows/linux)
- Shows all sessions for the open vscode folder (even external / pre-existing sessions).
- Rich text messages give you clickable links, rendered markdown, and Mermaid diagrams.
- Typeahead @filementions
- Typeahead #hashcommands to inject customizable prompts. (basic prompt templates)
- Pin sessions to keep it at the top of the session list.
- Using /tree in terminal impacts the qcode UI immediately.
- Paste in a screenshot or binary file reference.

## Prerequisites

Install and authenticate the [Pi CLI](https://pi.dev)

No additional Pi extensions are required. qcode explicitly loads its bundled bridge extension into every Pi terminal it creates.

## Install from vscode marketplace

[Visit Marketplace](https://marketplace.visualstudio.com/items?itemName=QuincyMitchell.pi-qcode)

## Install from cloning this repo

```sh
npm install
npm run package-install
```

and if you don't like it,

```sh
npm run package-uninstall
```

## Screenshots

1. Main screen

<img width="1019" height="584" alt="main" src="https://github.com/user-attachments/assets/414875bb-d4ff-4dde-8493-a35aca5f076d" />

<br><br> 2. New session with quick toggle of preferred model settings.

<img width="288" height="393" alt="new_session" src="https://github.com/user-attachments/assets/c7f20107-a719-4777-9c4a-6dcd8298a11c" />

<br><br> 3. Session Detail + Context coloring definition

<img width="625" height="467" alt="colored_context" src="https://github.com/user-attachments/assets/3eb7b2f3-2bf1-41de-a42c-c4bf02b4fdf2" />

<br><br> 4. When you send a message, the new message scrolls into view from the top of the message. No more wasting time scrolling up!

https://github.com/user-attachments/assets/378e3deb-4df9-46ee-8145-32276db4d62e

<br><br> 5. Typeahead @filementions

<img width="262" height="273" alt="autocomplete_file" src="https://github.com/user-attachments/assets/64649aba-0e88-4e67-a73b-0818ff6702f4" />

<br><br> 6. Typeahead #hashcommands to inject customizable prompts.

<img width="384" height="227" alt="autocomplete_hash" src="https://github.com/user-attachments/assets/6cfa81d2-aa2e-43c2-9802-680963384788" />

<br><br> 7. More context info by Hovering

<img width="320" height="131" alt="context_hover" src="https://github.com/user-attachments/assets/16a9945f-026c-4111-b976-8cbb850ca11f" />

<br><br> 8. Copy code blocks or Copy full message or highlight and copy

<img width="281" height="456" alt="copy_codeblock" src="https://github.com/user-attachments/assets/7708b4b8-9944-485b-965c-d0e8194f98e2" />

<img width="280" height="401" alt="copy_message" src="https://github.com/user-attachments/assets/490977d3-380e-4e47-8722-e5e99b2b4c71" />

<br><br> 9. Settings - Customize your preferred model settings

<img width="350" height="383" alt="settings_provider" src="https://github.com/user-attachments/assets/c8c58fd2-954f-454b-a9b1-623617eaa20a" />

<br><br> 10. Settings - Customize your hashtag autocomplete commands

<img width="352" height="555" alt="settings_command" src="https://github.com/user-attachments/assets/fbbaee9a-6619-4c18-a694-d2b280b8d0fd" />

<br><br> 11. Settings - Toggle or Customize a sound to notify you the agent is finished

<img width="356" height="173" alt="settings_notification" src="https://github.com/user-attachments/assets/bc34bfb2-d9b3-4147-a0b6-794b39dbfc89" />

<br><br> 12. "Add to pi-qcode" is a context menu inside vscode editor and vscode terminal so you can quickly add it to the already drafted chat or start a new chat with that context.

<img width="461" height="218" alt="image" src="https://github.com/user-attachments/assets/792dbaa8-8ff4-456d-ab51-b2446b5baafc" />

<img width="383" height="418" alt="image" src="https://github.com/user-attachments/assets/18ec7044-cb01-4ada-b345-72e18497be7d" />

## FAQ

**How does the Pi bridge work?**

qcode starts an ordinary, visible Pi terminal and loads its dependency-free bridge with `pi -e`. The terminal's Pi process remains the sole owner of the session, so you can click the terminal and use the Pi TUI at any time. The bridge only transports structured events and user messages; it does not add tools, prompts, or model context. It costs 0 tokens.

**How can a Pi extension tell qcode that the terminal is waiting for user input?**

Pi does not currently expose terminal-dialog lifecycle events. An extension that opens a blocking `ctx.ui` prompt can publish paired events on Pi's shared `pi-lifecycle` event channel. qcode then displays a notice telling the user to open the Pi terminal.

```ts
const waitId = `my-extension:${event.toolCallId}`;

pi.events.emit("pi-lifecycle", {
  version: 1,
  event: "user_input_wait_start",
  waitId,
  message: "Approval is required.", // Optional; do not include sensitive data.
});

try {
  const choice = await ctx.ui.select("Continue?", ["Yes", "No"]);
  // Handle the choice.
} finally {
  pi.events.emit("pi-lifecycle", {
    version: 1,
    event: "user_input_wait_end",
    waitId,
  });
}
```

Each wait must have a non-empty ID that is unique among currently open prompts. Always emit the matching `user_input_wait_end` from a `finally` block so Escape, errors, and cancellation clear the notice. These events are process-local and add no model context or token cost. The qcode bridge retains currently open waits in memory so a bridge socket reconnection still reports the correct state.

**Does it work on windows?**

Maybe? It's untested, but it might work. Windows could be configured in a million ways. The most likely happy path is native Windows with VS Code's default integrated terminal set to PowerShell (PowerShell 7 / `pwsh` preferred). Install and authenticate Pi, then confirm that `pi` runs successfully in that same VS Code terminal before using qcode.

If you use WSL, open the project through VS Code Remote - WSL instead of selecting `wsl.exe` as the terminal profile in a local Windows window. Other shell configurations, including Git Bash, may work but have not been tested.

## Thanks & Shoutouts

Inspiration for this project came from these inspiring projects:

- [m7l5/pi-msg](https://github.com/m7l5/pi-msg)
- [Cline/Cline](https://github.com/cline/cline)
