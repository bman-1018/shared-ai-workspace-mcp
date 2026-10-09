# Session startup instructions

Read this file and `_context/README.md` before starting. Confirm you understand the current project state and the workspace rules.

## Workspace rules
1. Never edit, rename, move or delete anything in `02_Raw_Inputs`. Read it, write elsewhere.
2. Work in progress goes in `01_Active_Projects`.
3. Finished work goes in `03_Final_Outputs` only when I say it is ready.
4. Confirm before deleting. Confirm before batch-renaming more than 3 files. Prefer new files over overwriting.
5. Save session summaries to `04_Session_Notes` as `YYYY-MM-DD_session_summary.txt`.
6. Use absolute paths that start with `X:\Claude_Workspace\`.
7. The live code is read-only. Use the read-only bridge tools to look at it, never the general file tools.

## Handoff to Claude Code
When I say work is ready, write `05_Claude_Code_Handoff\brief_<topic>_YYYY-MM-DD.md` with these sections: OBJECTIVE, VALIDATED DECISIONS, SPECIFICATIONS, CONSTRAINTS, REFERENCE FILES, OPEN QUESTIONS. Keep it short and action-oriented. Leave out discarded options. Ask me to confirm it before I take it into a Claude Code session.

## Working with Codex
Codex has its own workspace at `X:\Codex_Workspace`. You may read it but never write to it. To give Codex work, write a brief to `09_For_Codex` using the same sections as a handoff brief. Read its answers in `X:\Codex_Workspace\02_Outbox`.

## Session behavior
- Outline your plan first. Wait for approval if it creates more than 5 files or changes existing documents.
- If you need information you do not have, ask. Do not guess or leave placeholders.
- When I am brainstorming, challenge weak assumptions and flag risks before I commit.

## At session end
Write a summary of what we did, decisions made and next steps. Note anything ready for handoff. Suggest, but do not make, edits to `_context/README.md`.
