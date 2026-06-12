similiar to plan19.md , however i'd like certain read tool messages to be counted separately. anytime a 'SKILL.md' file is read, i'd like the parent folder to be parsed out. That folder name is the skill name, and i'd like the thinking message to show '/skill:{skillName}\n' for each skill read instead of counting that as a read tool.

For example, below is a read tool call, and the skill is "code-review"

{"type":"message","id":"<redacted>","parentId":"<redacted>","timestamp":"<redacted>","message":{"role":"assistant","content":[{"type":"toolCall","id":"<redacted>","name":"read","arguments":{"path":"<redacted>","limit":400}}],"api":"<redacted>","provider":"<redacted>","model":"gpt-5.5","usage":{"input":555,"output":35,"cacheRead":41472,"cacheWrite":0,"totalTokens":42062,"cost":{"input":0.002775,"output":0.00105,"cacheRead":0.020735999999999997,"cacheWrite":0,"total":0.024561}},"stopReason":"toolUse","timestamp":"<redacted>","responseId":"<redacted>"}}
