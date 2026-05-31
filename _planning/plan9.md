Starting a new session

1. Add a button on the home screen to start a new session.

2. When button is clicked, navigate to the session detail screen, however it'll be blank and it won't have a session file to read yet. Focus the input box so the user can start typing.

3. When the send button is clicked, perform 2 actions. take a snapshot of the most recently created file within the pi session folder for this cwd. Then open a vscode terminal with a slightly different command. Keep the existing command intact for when a session filename is known. But in this case, session file is not known, so the command is slightly different:

```
pi "/msg-on <guid>" "<message>"
```

How to discover the session folder for this cwd:

"{sessionsDir}/{theSessionFolder}"

sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");

theSessionFolder = this will be "--{x}--" where x is the translated path of the session cwd. The translated path is where all the "/" are placed with "-". For example if a session is started in "/home/user/project" the session folder will be "--home-user-project--".

After the command is ran, look for a new file inside that session folder by comparing the newest file before and after the command. Keep checking for the new file every 200ms for 3 seconds. If a new file is found, then use that file as the session file for this screen. Don't navigate, just update the memory values so that this screen now has a session file known. If no new file is found after 3 seconds, then display an error message to the user that the session file could not be found.
