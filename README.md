# pi-qcode

Native vscode extension for pi coding agent. Uses pi cli within vscode terminal to power the extension behind the scenes while rendering rich UI in the native extension.

The design is meant to be a chill version of the pi experience, but you can immediately jump to the full Pi experience at any time you want. qcode UI supresses the noisy messages and only shows the final turn messages + user messages. Go to the active vscode terminal to go back to the full pi experience.

If you like it, consider a [donation](http://venmo.com/quincycs).


Demo below. Scroll to the bottom for more screenshots and video.

https://github.com/user-attachments/assets/d4b264ce-1b24-4532-8c6b-93db5f4052b9


## Features

- Powered by Pi inside vscode terminal, so you can jump into the full experience anytime.
- UI only shows the final turn messages + user messages, suppressing the noisy messages.
- Thinking... indicator shows summary of what's happening (eg skills activated, and counts of tool calls).
- "Enter" key is a new line, encouraging you to slowdown and think before sending. Use `cmd+enter` (mac) or `ctrl+enter` (windows/linux) to send.
- "Add to pi-qcode" is a context menu option to add highlighted code in the editor into a draft message to send to pi. This menu is also available in the vscode terminal. Hotkey: `cmd+;` (mac) or `ctrl+;` (windows/linux)
- Shows all sessions for the open vscode folder (even external / pre-existing sessions).
- Rich text messages give you clickable links and rendered markdown.
- Typeahead @filementions
- Typeahead #hashcommands to inject customizable prompts. (basic prompt templates)

## Prerequisites

Install the pi cli. [more info](https://pi.dev)

Install two pi extensions:

- `pi-msg` [more info](https://github.com/m7l5/pi-msg)
- `pi-lifecycle` [more info](https://github.com/quincycs/pi-lifecycle)

```sh
pi install git:github.com/m7l5/pi-msg
pi install git:github.com/quincycs/pi-lifecycle
```

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


2. New session with quick toggle of preferred model settings.

<img width="288" height="393" alt="new_session" src="https://github.com/user-attachments/assets/c7f20107-a719-4777-9c4a-6dcd8298a11c" />


3. Session Detail + Context coloring definition

<img width="625" height="467" alt="colored_context" src="https://github.com/user-attachments/assets/3eb7b2f3-2bf1-41de-a42c-c4bf02b4fdf2" />


4. When you send a message, the new message scrolls into view from the top of the message.  No more wasting time scrolling up!

https://github.com/user-attachments/assets/378e3deb-4df9-46ee-8145-32276db4d62e


5. Typeahead @filementions

<img width="262" height="273" alt="autocomplete_file" src="https://github.com/user-attachments/assets/64649aba-0e88-4e67-a73b-0818ff6702f4" />


6. Typeahead #hashcommands to inject customizable prompts.

<img width="384" height="227" alt="autocomplete_hash" src="https://github.com/user-attachments/assets/6cfa81d2-aa2e-43c2-9802-680963384788" />


7. More context info by Hovering

<img width="320" height="131" alt="context_hover" src="https://github.com/user-attachments/assets/16a9945f-026c-4111-b976-8cbb850ca11f" />


8. Copy code blocks or Copy full message or highlight and copy

<img width="281" height="456" alt="copy_codeblock" src="https://github.com/user-attachments/assets/7708b4b8-9944-485b-965c-d0e8194f98e2" />

<img width="280" height="401" alt="copy_message" src="https://github.com/user-attachments/assets/490977d3-380e-4e47-8722-e5e99b2b4c71" />


9. Settings - Customize your preferred model settings

<img width="350" height="383" alt="settings_provider" src="https://github.com/user-attachments/assets/c8c58fd2-954f-454b-a9b1-623617eaa20a" />


10. Settings - Customize your hashtag autocomplete commands

<img width="352" height="555" alt="settings_command" src="https://github.com/user-attachments/assets/fbbaee9a-6619-4c18-a694-d2b280b8d0fd" />


11. Settings - Toggle or Customize a sound to notify you the agent is finished

<img width="356" height="173" alt="settings_notification" src="https://github.com/user-attachments/assets/bc34bfb2-d9b3-4147-a0b6-794b39dbfc89" />


12. "Add to pi-qcode" is a context menu inside vscode editor and vscode terminal so you can quickly add it to the already drafted chat or start a new chat with that context.

<img width="461" height="218" alt="image" src="https://github.com/user-attachments/assets/792dbaa8-8ff4-456d-ab51-b2446b5baafc" />

<img width="383" height="418" alt="image" src="https://github.com/user-attachments/assets/18ec7044-cb01-4ada-b345-72e18497be7d" />


## Thanks & Shoutouts

Inspiration for this project came from these inspiring projects:

- [m7l5/pi-msg](https://github.com/m7l5/pi-msg)
- [Cline/Cline](https://github.com/cline/cline)
