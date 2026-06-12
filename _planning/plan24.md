currently the 'thinking...' message is still shown when an error occurs. instead, transition thinking to an assistant message showing the error message.

here's an example of such a message:,

{"type":"message","id":"<redacted>","parentId":"<redacted>","timestamp":"<redacted>","message":{"role":"assistant","content":[],"api":"openai-codex-responses","provider":"openai-codex","model":"gpt-5.3-codex","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":"<redacted>","errorMessage":"Codex error: {\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.\"}}"}}
