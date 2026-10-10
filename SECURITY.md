# Security

This project gives an AI model tools that touch real files and run code on your computer. That is useful and it carries risk. This page says what the risks are, what has been fixed, and how to use the setup safely.

## What you are trusting

| Component | What it can do | Main risk |
|---|---|---|
| `the_forge` + `Hot_Plugins` | Loads and runs every `.js` file in `Hot_Plugins` as you, and logs tool calls | Anything that can write a `.js` file there can run code on your PC |
| `panoptic_push` | Writes files into the workspace folders. The routes into `_mcp_tools` and `Claude_Plugins` are off unless you set `X9_ALLOW_PLUGIN_WRITE=1` | With that setting on, it can be used to add a plugin that runs on your PC |
| `X9_External_Drive` (official file server) | Reads, writes and moves files in the folders you give it | If the folder list includes `_mcp_tools` or `Claude_Plugins`, for example by listing the whole workspace, Claude can add a plugin that runs on your PC. The example config lists only safe subfolders |
| `x9_search` | Returns text from your indexed files, including the Codex workspace if one sits next to yours | Whatever is indexed can be shown to the model. The index file holds that text in plain form |
| `save_session_summary` / `find_sessions` | Write a summary file into `04_Session_Notes` (never overwrites); list and read summaries from the Claude and Codex summary folders | Summaries are plain text that the other agent reads. Secrets are filtered by pattern only, so a password the model writes in plain words is not caught. `find_sessions` can read only regular `.md` files directly inside those folders. Text from the other agent reaches the model as data; the tool descriptions and the server instructions say it must not be followed as instructions, but that is not enforced |
| `readonly_bridge` | Reads one folder you choose (size-limited), runs four read-only git commands | Shows the model the files in that folder. The secret filter is by file name only, and `git diff` can show the contents of tracked files |
| `The_Observer` | Copies the chat log (`audit.jsonl`) of Claude Desktop agent-mode sessions to the drive | Plain-text copy of those conversations |

## Safe use checklist

1. **Treat `Hot_Plugins` like your Startup folder.** Only put code there that you have read. Claude cannot create plugins through `panoptic_push` unless you set `X9_ALLOW_PLUGIN_WRITE=1`. Leave it off unless you want that. Also keep `_mcp_tools` and `Claude_Plugins` out of the folders you give `X9_External_Drive`. The file server has no deny list, so list subfolders instead of the workspace root.
2. **Leave secret blocking on in the bridge** (it is the default) and still keep real secrets out of the folder you share. Blocking is a filename filter, not a guarantee.
3. **Encrypt the drive.** The workspace, the search index, the Forge action log and the chat exports are all readable text. Use BitLocker To Go or an equivalent if the drive can be lost or stolen.
4. **Do not publish your workspace.** `.gitignore` excludes `*.db`, `07_Chat_History/`, `node_modules/` and `claude_desktop_config.json`. Keep it that way, and check `git status` before every push.
5. **Beware prompt injection.** A document you ask Claude to read can contain instructions aimed at the model. Tools that write files make that more serious. Review what Claude is about to write when it handles untrusted content.
6. **Keep dependencies current.** Run `npm run audit:all` now and then.

## Review history

A security review was done in October 2026 before this repo was released. It was run by the author, not by an independent party, so it is not an independent audit. It covered all source files, the dependency lockfiles, and a search for secrets and personal data. No credentials were found. The fixes were first tested on Linux with Windows path rules simulated. Since then, CI runs the full test suite on Windows and Ubuntu (Node 20 and 22) for every pull request. Those tests use temporary folders, not Claude Desktop or a real external drive.

### Fixed

| Severity | Issue | Fix |
|---|---|---|
| High | `panoptic_push` joined the `filename` argument to the destination folder without checking it. A name such as `..\..\x.js` could write outside the chosen folder, including into `Hot_Plugins`, which the Forge then executes. | All paths now pass through `resolveInside()` in `Hot_Plugins/_shared.js`, which rejects `..`, absolute paths, drive letters, alternate data streams and illegal characters. Chunk size and file size are capped. Temporary files are namespaced by category. |
| High | `x9_python_bridge` built a command line by string concatenation and ran it through `cmd.exe`. Escaping `"` with a backslash does not work in `cmd.exe`, so a search query could contain `& other-command` and run it. | It now uses `execFile` with an argument array and no shell. Query length is limited and a timeout is set. |
| Medium | `readonly_bridge` checked the allowed folder with `startsWith`, so `C:\app-secrets` passed as inside `C:\app`. Symlinks and junctions inside the folder could also point outside it. | Containment is now checked by path segments with `path.relative()` and again after resolving the real path. |
| Medium | `submit_code_plan` used `feature_name` in a file name unchecked. | The name is reduced to letters, digits, spaces, `_` and `-`, and the final path is checked. |
| Medium | Dependencies had known vulnerabilities (10 in `the_forge` and `readonly_bridge` each, including 1 critical; 8 high in `The_Observer`). | MCP SDK raised to 1.32.1 within its major version; transitive packages updated by `npm audit fix`. `npm audit` now reports 0 for all three. The unused `puppeteer` dependency was removed from `The_Observer`. |
| Low | The git tool ran through a shell and honored repository config that can launch helper programs. | It uses `execFile` with fixed arguments, `--no-ext-diff`, `--no-textconv` and `core.fsmonitor=false`. |
| Low | The background sync could start a new run while the last one was still running, and the Forge crashed if its plugin folder or drive was missing. | Overlap guard, timeouts, and clear error messages. |
| Low | The search index opened its database read-write for queries, and indexed files named like secrets. | Queries open the index read-only. File names containing `secret`, `credential`, `private key`, `id_rsa` and similar are skipped. |
| Info | Hard-coded personal paths and business-specific folder names. | Replaced with `X9_ROOT`, relative paths and a generic folder layout. |
| Medium | The example config gave the `X9_External_Drive` file server the whole workspace, which contains `_mcp_tools\Hot_Plugins`. The file server could write a `.js` file there and the Forge would run it, so the `X9_ALLOW_PLUGIN_WRITE` default could be bypassed. Found after the main review. | The example config now lists workspace subfolders and leaves out `_mcp_tools` and `Claude_Plugins`. Tested with file server 2026.8.31 on Linux: with the workspace root a write into `Hot_Plugins` succeeds, with the subfolder list it is refused. |

### Safer defaults added after the review

| Change | Why |
|---|---|
| The `panoptic_push` routes into `_mcp_tools` and `Claude_Plugins` are off unless `X9_ALLOW_PLUGIN_WRITE=1` | A prompt-injected or mistaken write could otherwise add code that runs on your PC |
| The bridge blocks secret-looking file names by default (`READONLY_BRIDGE_BLOCK_SECRETS=0` turns it off) | Safer out of the box |
| The bridge limits a file to 512 KB and a multi-file read to 2 MB and 50 files, and refuses binary files | Stops one request from flooding the model's context or stalling the server |
| The Observer copies only `audit.jsonl`, not the whole session folders | Uploads, outputs and caches stay where they are |
| The Forge log keeps one JSON object per line, cuts long values, hides secret-looking keys and values, and can be turned off with `X9_FORGE_LOG=off` | The old log stored full file contents and was not valid JSON |
| The search tool is named `x9_search` | It is keyword search, not semantic search |
| `X9_External_Drive` lists workspace subfolders, not the workspace root | The file server cannot exclude a folder, so listing the root would let Claude write a plugin |
| Search skips the Forge action log and the raw chat copies in `07_Chat_History`, and rebuilds the index into a temporary file before swapping it in | The action log repeats earlier results and file contents; a rebuild during a search never shows a half-built index |
| Session summaries are saved with exclusive create, a safe file name, one-line quoted titles and secret patterns replaced (keys, tokens, JSON web tokens, `user:password@` URLs and `password: value` text; best effort). `find_sessions` skips symbolic links | A summary can not overwrite an earlier one, escape its folder, or forge its own header |
| Search and lookup tools declare themselves read only | Lets the client skip repeated approval for reads. It is a hint to the client, not a security control: the code still enforces what each tool can do |

### Known and accepted

- Hot plugins execute with your user rights. This is the purpose of the Forge.
- The Forge log filter is best-effort. Secrets in unusual formats can still end up in the log. Turn the log off if that matters to you.
- The Observer's copy of your chats is plain text and contains whatever you and Claude said.
- `panoptic_push` and `readonly_bridge` cannot protect you from sensitive data you place in the folders they are allowed to use.
- Files at the workspace root, such as `CLAUDE.md`, are not reachable through `X9_External_Drive` with the example config. Claude Code reads `CLAUDE.md` on its own. If you want Claude Desktop to edit root files, add the workspace root to the server's folder list and accept the plugin risk described above.
- The folder `02_Raw_Inputs` is described as read-only, but that is a convention for the AI, not something the tools enforce.
- The Forge reloads plugins by importing a new copy of the file each time. Many reloads in one long session use more memory until you restart Claude Desktop.
- The Forge and bridge are plain Node programs and may run elsewhere, but only Windows is supported and tested for the Observer and the setup instructions.

## Reporting a problem

Please open a private security advisory on this repository (Security tab, "Report a vulnerability") instead of a public issue.
