# Codex workspace instructions

## Purpose
This folder is Codex's own workspace. The Claude workspace is at `X:\Claude_Workspace`.

## Access rules
- You may write only inside `X:\Codex_Workspace`.
- You may read `X:\Claude_Workspace` but must never create, edit, move or delete anything there.
- Briefs for you are in `X:\Claude_Workspace\09_For_Codex`. Read them from there. Do not copy them back.
- Put your results in `02_Outbox`. Claude reads that folder.

## Folders
- `01_Active_Tasks`: work in progress, one file or folder per task.
- `02_Outbox`: finished reviews and results for Claude to read.
- `02_Outbox/session_summaries`: one summary per work session (see below).
- `docs/plans`: longer plans and design notes.
- `Outputs`: generated files.
- `skills`, `plugins`: Codex skills and plugins.

## Rules
- Name files `YYYY-MM-DD_topic.md`.
- Confirm before deleting or moving more than 3 files.
- State what you verified and what you did not. Do not mark something done that you did not check.
- Do not read `X:\Claude_Workspace\02_Raw_Inputs` unless a brief tells you to.

## When you finish a task
Write a short result to `02_Outbox`: which brief it answers, what you found or changed, what you checked, and what is still open.

## Session summaries
- At the end of a work session, write a summary to `02_Outbox/session_summaries/YYYY-MM-DD_topic.md`. Copy the format of `_template_session_summary.md` in that folder. Summarize, do not paste the conversation.
- Write it so Claude or a later session can continue without the original chat: what you were asked, what you did, decisions and the reason for each, exact file, folder and branch names, what is unfinished, and what to do first next.
- Never include passwords, keys or tokens.
- Before you start, read the newest files in `X:\Claude_Workspace\04_Session_Notes` to see what Claude decided. Claude's tools read your summaries from this folder.
