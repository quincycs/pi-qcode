when sending the first message, code should stay the same as described in plan4.md

when sending the 2+ message, the send button should perform different actions in order to continue the conversation in the same session. These are as follows:

1. The guid that was generated is used to find the unix socket path to send the message.
2. Look at line 420 of ../pi-msg/index.ts for how to send a message to this socket.
3. Reproduce this code in this repo. Don't import any code from ../pi-msg , but use it as reference to write similiar code in this repo.
