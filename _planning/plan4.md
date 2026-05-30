Support sending a message on the session detail screen.

1. Change the text input as a multiline text input. Allow the text input to grow up to 10 lines of height before reaching it's max height. Vertical scrolling should be enabled for the text input.

2. The send button when clicked for the first time, should perform the following actions:

3. Open a vscode terminal with the cwd at the workspace location and run the following command. (generate a new guid and hold it in memory to be used later.)

```
pi --session <sessionFilePath> "/msg-on <guid>" "<message>"
```

- sessionFilePath should be available as a parameter on the session detail screen.
- guid should be a generated guid that is held in memory for future usage.
- message should be the content of the text input. newlines should be encoded as \n in the message.
