look into why this below .jsonl results in always a 'thinking' message and the final message is not rendered. I'm expecting "1, 2, 3, 4, 5, 6, 7, 8, 9, 10! 🎉" to be shown as an assistant message in the UI.

{"type":"session","version":3,"id":"<redacted>","timestamp":"<redacted>","cwd":"<redacted>"}
{"type":"model_change","id":"<redacted>","parentId":null,"timestamp":"<redacted>","provider":"<redacted>","modelId":"anthropic/claude-sonnet-4.6"}
{"type":"thinking_level_change","id":"<redacted>","parentId":"<redacted>","timestamp":"<redacted>","thinkingLevel":"high"}
{"type":"message","id":"<redacted>","parentId":"<redacted>","timestamp":"<redacted>","message":{"role":"user","content":[{"type":"text","text":"count to 10"}],"timestamp":"<redacted>"}}
{"type":"message","id":"<redacted>","parentId":"<redacted>","timestamp":"<redacted>","message":{"role":"assistant","content":[{"type":"text","text":"1, 2, 3, 4, 5, 6, 7, 8, 9, 10! 🎉"}],"api":"<redacted>","provider":"<redacted>","model":"anthropic/claude-sonnet-4.6","usage":{"input":3,"output":37,"cacheRead":2985,"cacheWrite":0,"totalTokens":3025,"cost":{"input":0.000009,"output":0.000555,"cacheRead":0.0008954999999999999,"cacheWrite":0,"total":0.0014594999999999999}},"stopReason":"stop","timestamp":"<redacted>","responseId":"<redacted>","responseModel":"anthropic/claude-4.6-sonnet-20260217"}}
