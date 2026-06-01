# pi-qcode

Native vscode extension for pi coding agent. Uses pi cli within vscode terminal to power the extension behind the scenes while rendering rich UI in the native extension.

The design is meant to be a chill version of the pi experience, where messages in the session detail only the important final turn messages + user messages. Go to the vs terminal to see everything pi is doing under the hood if necessary.

## Features

- Recent sessions for the open vscode folder.
- Sessions created outside the extension are also integrated.
- Rich text messages give you clickable links and rendered markdown.
- "Add to pi-qcode" is a context menu option to add highlighted code in the editor into a draft message to send to pi.
- Typeahead @filementions
- Customizable typeahead #hashcommands to inject prompts.
- Opens pi inside vscode terminal, so you can jump into the terminal and interact with pi directly if ever necessary.
- Thinking... gives a summary of what pi is doing.

## Prerequisites

Install the pi cli. [more info](https://pi.dev)

Install a needed pi extension: `pi-msg` [more info](https://github.com/m7l5/pi-msg)

```sh
pi install git:github.com/m7l5/pi-msg
```

## Local development

```sh
npm install
npm run package-install
```

## Thanks & Shoutouts

Inspiration for this project came from these inspiring projects:

- [m7l5/pi-msg](https://github.com/m7l5/pi-msg)
- [AcendWay/PiDE_Piper_VSCode_Extention](https://github.com/AcendWay/PiDE_Piper_VSCode_Extention)
- [Cline/Cline](https://github.com/cline/cline)
