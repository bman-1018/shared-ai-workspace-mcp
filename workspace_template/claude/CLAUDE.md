# Memory

Short and always loaded. Keep it under about 150 lines. Details live in `memory/` and `_context/`.

## Me
<Your name>, <role>. <One or two lines about what you are building and how you like to work.>

## Terms
| Term | Meaning |
|------|---------|
| <term> | <meaning> |
Full list: `memory/glossary.md`

## Projects
| Name | What | Status |
|------|------|--------|
| <project> | <one line> | <active, paused, done> |
Details: `memory/projects/`

## Workspace
```
X:\Claude_Workspace\
  01_Active_Projects   work in progress
  02_Raw_Inputs        read-only source material
  03_Final_Outputs     finished work only
  04_Session_Notes     session summaries
  05_Claude_Code_Handoff  briefs for Claude Code
  09_For_Codex         briefs for Codex to read
  memory               long-term notes
```

## Preferences
- Dates in file names: YYYY-MM-DD
- Confirm before deleting, moving or batch-renaming more than 3 files
- Create new files instead of overwriting
- Challenge weak assumptions and flag risks before committing to a direction

## Rules
- Use absolute paths that start with `X:\Claude_Workspace\` when writing files.
- Never edit anything in `02_Raw_Inputs`.
- A handoff brief must name the chat session it came from.
- Codex can only read this workspace. Write briefs for it to `09_For_Codex`. Read its results in `X:\Codex_Workspace\02_Outbox` (read-only for you, do not write there).
- Task list: `X:\Claude_Workspace\Tasks\tasks.md`

## Last updated
<YYYY-MM-DD>
