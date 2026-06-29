# pi-qcode

Native vscode extension for pi coding agent. Uses pi cli within vscode terminal to power the extension behind the scenes while rendering rich UI in the native extension.

The design is meant to be a chill version of the pi experience, but you can immediately jump to the full Pi experience at any time you want. qcode UI supresses the noisy messages and only shows the final turn messages + user messages. Go to the active vscode terminal to go back to the full pi experience.

If you like it, consider a [donation](http://venmo.com/quincycs).

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

## Thanks & Shoutouts

Inspiration for this project came from these inspiring projects:

- [m7l5/pi-msg](https://github.com/m7l5/pi-msg)
- [Cline/Cline](https://github.com/cline/cline)
