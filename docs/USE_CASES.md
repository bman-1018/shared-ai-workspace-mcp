# Use cases

How the workspace gets used day to day. For setup, see the [README](../README.md) and [CONFIGURATION](CONFIGURATION.md).

Everything below works the same in Claude Desktop, Codex (ChatGPT desktop app) and Cline, because they all run the same Forge on the same drive. It works in any session running on your PC. Cloud sessions (Claude Code on the web, Codex in ChatGPT on the web) cannot reach the drive, on purpose: see [Remote access](../SECURITY.md#remote-access-is-not-supported).

## 1. Hand work from one AI to the other

**When:** you are done for now in one app and want the other one to carry on, in either direction.

**Say, in the app you are leaving:**

> Save anything Claude needs to do to the Forge, so I can have Claude pull in this information.

(Or "...anything Codex needs to do..." when going the other way.)

**What happens:** the app saves the handoff, the next tasks in order, and a searchable session summary to the workspace. Ask it to also give you a prompt for the other app. A real one, from Codex to Claude:

> Use The Forge's `find_sessions` to search PR105. Read "PR105 research handoff", then the linked handoff and continuation plan. Verify the current PR head before continuing.

**Then:** paste that prompt into the other app. It finds the summary, reads the linked files, and picks up where the first one stopped.

Tips:
- Asking the first app to write the prompt works better than writing it yourself: it knows the exact titles it saved.
- "Verify the current PR head" (or "check the files are still as described") stops the second app from trusting notes that have gone out of date.

## 2. Share files that must not go to GitHub

**When:** both AIs need something that belongs to the project but should stay on your PC: test scripts, scratch results, local notes, test data.

**Say:**

> Save this test script to the Forge for Codex. Do not commit it.

**What happens:** the file goes to the workspace on the drive, not into the repo. The other app reads it from there, and it never reaches GitHub.

Keep real secrets out. Session summaries and the Forge's tool log hide secret-looking values, so a key passed through a summary may arrive as `[REDACTED]`, and anything on the drive is readable by every app you connect to it. See [SECURITY.md](../SECURITY.md).

## 3. Pull in old context with search

**When:** you start a new chat about something from days or weeks ago, and the details are not in `CLAUDE.md`, `MEMORY.md` or any other memory file.

**Say:**

> Use find_sessions to find what we decided about the market filter last week, then summarize it before we start.

> Search the workspace for "trend chop" and list the files that mention it.

**What happens:** `find_sessions` lists session summaries from both Claude and Codex, newest first. `x9_search` searches every text file in the workspace. With [semantic search](CONFIGURATION.md#semantic-search-optional) installed, it also finds files that mean the same thing in different words.

This is the main reason to save a summary at the end of every real work session: a later chat in either app can find it.

## What to say, at a glance

| You want to | Say |
|---|---|
| Hand off to the other AI | "Save anything Codex/Claude needs to do to the Forge, and give me a prompt for it." |
| Pick up a handoff | Paste the prompt it gave you. |
| Keep something off GitHub | "Save this to the Forge for Codex/Claude. Do not commit it." |
| Find old context | "Use find_sessions to find..." or "Search the workspace for..." |
| End a session | "Save a session summary." |
