change session detail to only render user messages and messages that have a "phase" field with the value "final".

look at a few .jsonl files for examples. <redacted>

Change the render of the messages so that there's no 'role' in the UI displayed. Instead, have the indicator be a color. User messages should be blue, and assistant messages should say the same color they are today. Just remove the "role" text.
