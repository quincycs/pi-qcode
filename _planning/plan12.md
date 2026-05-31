inside session detail when a user message is the last message rendered, then I'd like a 'thinking' message to be rendered like a special kind of message.

it's not a direct mapping to 'thinking' content in the .jsonl file, but rather an aggegate of what's going on in the session after the last user message.

I'd like all content that we aren't rendering to be grouped and counted. Look inside the Pi documentation for session format and each "Entry Type". I'd then like the thinking message to render the count of each entry type that happened. If 0 of a certain type happened, then it shouldn't be included in the thinking message.

As new messages come in the thinking message should update to reflect the new counts.

If a new user message comes in, then the thinking message should disappear until we have new content to aggregate and count again.
