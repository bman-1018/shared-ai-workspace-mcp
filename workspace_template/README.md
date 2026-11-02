# Workspace templates

Two ready-to-copy folder layouts. They work in any folder: on `C:`, on a partition of their own, or on an external drive. The examples use drive `X:`.

| Template | Used by | Purpose |
|---|---|---|
| `claude/` | Claude Desktop (chat, Cowork) and Claude Code | Shared memory, projects, session notes and handoff briefs |
| `codex/` | Codex | Active tasks and an outbox, so work can move between agents as plain files |

The problem this solves: chats and agents forget everything between sessions and do not share a memory. Keeping the memory as plain files in a folder that every tool can reach fixes both.

## How to use

1. Copy `claude/` to `X:\Claude_Workspace` and `codex/` to `X:\Codex_Workspace`.
2. Open `X:\Claude_Workspace\CLAUDE.md` and fill in the `<...>` placeholders.
3. Open `X:\Codex_Workspace\AGENTS.md`. If your workspaces are not on `X:`, replace the `X:\...` paths with yours.
4. Point the Forge at the Claude workspace with `X9_ROOT` (see the main README).

Empty folders contain a `.gitkeep` file. Delete them if you like.

## Claude workspace

```
Claude_Workspace\
  CLAUDE.md                   short "hot cache": who you are, terms, rules, active projects
  _context\
    README.md                 long background: project, stack, workstreams
    session_start.md          rules the AI reads at the start of every session
  _mcp_tools\                 this repository (Forge, bridge, Observer, search)
  01_Active_Projects\         work in progress
  02_Raw_Inputs\              source material, treated as read-only
  03_Final_Outputs\           finished deliverables only
  04_Session_Notes\           one summary per session: YYYY-MM-DD_title.md, written by save_session_summary
  05_Claude_Code_Handoff\     briefs from chat to Claude Code: brief_<topic>_YYYY-MM-DD.md
  06_Code_Plans\              plans written by the submit_code_plan tool
  07_Chat_History\            logs and chat copies (created by the Forge and Observer, never commit)
  09_For_Codex\               briefs for Codex to read (Codex cannot write here)
  memory\
    glossary.md               your terms and what they mean
    people\                   one file per person
    projects\                 one file per project
    context\                  anything else worth keeping
  Tasks\tasks.md              task list
  Claude_Plugins\             plugins you keep on the drive
```

### Two-stage workflow

1. Stage 1, the architect: Claude Desktop (chat or Cowork). Research, planning, validation. It can read and write the drive and, through the read-only bridge, read your code without being able to change it.
2. Stage 2, the engineer: Claude Code. It builds from a handoff brief and does not need the story of how the decision was made.

Handoff briefs use the same six sections every time, which keeps them short and checkable:

```
OBJECTIVE            one or two sentences
VALIDATED DECISIONS  settled, treat as requirements
SPECIFICATIONS       data shapes, APIs, file formats
CONSTRAINTS          what must not be done, dependencies, blockers
REFERENCE FILES      paths to inputs, drafts and code to read
OPEN QUESTIONS       what is still unresolved
```

Name each brief `brief_<topic>_YYYY-MM-DD.md` and name the chat session it came from, so the next session can trace it back.

## Codex workspace

```
Codex_Workspace\
  AGENTS.md                   instructions Codex reads at the start
  01_Active_Tasks\            work in progress
  02_Outbox\                  finished reviews and results for Claude to read
  docs\plans\                 longer plans and design notes
  Outputs\                    generated files
  skills\                     Codex skills
  plugins\                    Codex plugins
```

## Sharing context without sharing write access

Each agent writes only to its own workspace and reads the other's:

- Claude writes briefs to `Claude_Workspace\09_For_Codex`. Codex reads them there.
- Codex writes results to `Codex_Workspace\02_Outbox`. Claude reads them through the read-only `Codex_ReadOnly` server (or the Forge's `find_sessions`).

Neither agent can change the other's files, so a mistake or a prompt injection on one side stays on that side. See the main README for the config and for the Codex sandbox setting that keeps it this way.

## Notes

- The Forge category list in `Hot_Plugins/x9_workspace_mapper.js` and the routes in `panoptic_push.js` assume the Claude layout above. Rename a folder in both places if you change it.
- The Forge routes in `panoptic_push.js` do not include `09_For_Codex`. Claude writes there through `X9_External_Drive`.
- Do not keep secrets, customer data or anything regulated in these folders. See `SECURITY.md`.
- The read-only bridge and the filesystem server are separate tools. Give the filesystem server only your workspace subfolders (see `claude_desktop_config.example.json`), not the whole drive and not the workspace root. The root contains `_mcp_tools`, and a file written there can run as a plugin.
- Files at the workspace root, such as `CLAUDE.md`, are outside the folders the example config gives the filesystem server, so Claude Desktop cannot edit them. Claude Code reads `CLAUDE.md` on its own.
