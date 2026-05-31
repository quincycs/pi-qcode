get inspiration from how cline renders messages in rich text.

look at code here: ../cline

Example of one of the rendered messages is below. Perhaps a markdown renderer could be used. I wonder what cline uses

---

Implemented `_planning/plan20.md`.

Changes in `src/sessionFiles.ts`:

- `read` tool calls targeting a `SKILL.md` file are now counted separately as skill usage.
- The skill name is parsed from the parent folder.
- A single skill read renders like:

```text
/skill:code-review
```

- Other read calls still count as normal `read` tool calls.

Validation:

- Ran `npm run compile` successfully.
