currently the 'thinking...' message is still shown when an abort occurs. instead, transition thinking to an assistant message showing the error message.

here's an example of such a message:

{"type":"message","id":"<redacted>","parentId":"<redacted>","timestamp":"<redacted>","message":{"role":"assistant","content":[{"type":"thinking","thinking":""}],"api":"<redacted>","provider":"<redacted>","model":"gpt-5.4-mini","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"aborted","timestamp":"<redacted>","responseId":"<redacted>","errorMessage":"Operation aborted"}}
