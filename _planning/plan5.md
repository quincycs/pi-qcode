When on the session detail screen, watch the session file for changes (if session file exists).

the file is changed only via append only technique. Therefore for repeated file reads we should only read the new lines that are added to the file for changes.

instead of rendering only the number of lines in a session, render the message text content of each line. I think we can reuse readText() function.

The main body of the screen should be a scrollable container of messages, and initially scrolled so that the top of the last message is visible. For example if the last message is very long, it won't fit inside the container, therefore the scroll region should be set so that the beginning of that less message is visible.
