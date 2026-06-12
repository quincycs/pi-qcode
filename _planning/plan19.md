inside the thinking message, I'd like the 'assistant' messages that are 'toolCall' have each tool seperately counted.

For example, the below line

"type":"toolCall" , this indicates it's a toolcall message.
"name":"bash" , this indicates the tool name.

Therefore I'd want the thinking message to show "bash: 2" as it would count 2 of the tool calls in this message.

{"type":"message","id":"<redacted>","parentId":"<redacted>","timestamp":"<redacted>","message":{"role":"assistant","content":[{"type":"thinking","thinking":"**Considering VSCode extension development**\n\nI need to start coding for a minimal VSCode extension, so my first step is to inspect the current directory. It's possible there’s an existing repository I can use for inspiration, but I’m unsure if it’s set up. I should check if it’s empty or has any relevant files. Let's go ahead and inspect that to see what I'm working with. This should help me get on the right path!","thinkingSignature":"<redacted>"},{"type":"toolCall","id":"<redacted>","name":"bash","arguments":{"command":"pwd && ls -la && find . -maxdepth 2 -type f | sed 's#^./##' | sort | head -200"}},{"type":"toolCall","id":"<redacted>","name":"bash","arguments":{"command":"ls -la <redacted> && find <redacted> -maxdepth 3 -type f | sed 's#<redacted>/##' | sort | head -200"}}],"api":"<redacted>","provider":"<redacted>","model":"gpt-5.5","usage":{"input":1847,"output":192,"cacheRead":0,"cacheWrite":0,"totalTokens":2039,"cost":{"input":0.009235,"output":0.00576,"cacheRead":0,"cacheWrite":0,"total":0.014995000000000001}},"stopReason":"toolUse","timestamp":"<redacted>","responseId":"<redacted>"}}
