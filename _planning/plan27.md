currently the 'thinking...' message is still shown when an abort occurs. instead, transition thinking to an assistant message showing the error message.

here's an example of such a message:

{"type":"message","id":"25bef090","parentId":"66161386","timestamp":"2026-06-02T04:19:35.896Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":""}],"api":"openai-codex-responses","provider":"openai-codex","model":"gpt-5.4-mini","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"aborted","timestamp":1780373974516,"responseId":"resp_0d7b3ade58f2a417016a1e59d6a63c819a9a56bc23532e1f0e","errorMessage":"Operation aborted"}}
