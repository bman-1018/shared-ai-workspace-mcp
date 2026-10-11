# Contributing

Thanks for taking a look. Bug reports, fixes for Windows setups that behave differently, and small focused plugins are all welcome.

## Before you start

- For a security problem, do not open an issue. Use a private advisory instead (see [SECURITY.md](SECURITY.md#reporting-a-problem)).
- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Never paste real chat logs, workspace files, API keys or your own `claude_desktop_config.json` into an issue or pull request. Cut the log down to the lines that show the problem.

## Development setup

You need Node.js 20 or newer. Python 3.10 or newer is optional; without it the search tests are skipped. The semantic search tests also need `numpy` (they use a stand-in embedder, so no model is downloaded). With `x9_search_engine/.venv` set up as in the README, one more test runs against the real model.

```
git clone https://github.com/bman-1018/shared-ai-workspace-mcp.git
cd shared-ai-workspace-mcp
npm run install:all
npm test
```

The tests use temporary folders. They do not need an external drive or Claude Desktop, and they run on Windows and Linux. CI runs them on Windows and Ubuntu with Node 20 and 22, plus `npm audit` and a registry signature check.

## Project layout

| Path | What it is |
|---|---|
| `the_forge/` | The plugin host (MCP server), action log, background index refresh |
| `Hot_Plugins/` | One file per tool. Files starting with `_` are helpers, not tools |
| `readonly_bridge/` | Read-only MCP server for one folder |
| `The_Observer/` | Copies Cowork chat logs to the drive and converts them to markdown |
| `x9_search_engine/` | Python indexer and query script (SQLite FTS5) |
| `tests/` | `node --test` suites; `tests/helpers/mcp_stdio.js` drives a server over stdio |
| `docs/ENGINEERING_NOTES.md` | Design decisions and the reasoning behind them |

## Writing a plugin

A plugin is a `.js` file in `Hot_Plugins` that exports `toolName`, `toolSchema` and `toolHandler`. Start from `hello_forge.js`.

Rules that keep the project safe:

1. **Every path that comes from the model goes through `resolveInside()`** in `Hot_Plugins/_shared.js`. Do not build paths with `path.join` on raw input.
2. **No shell.** Start programs with `execFile` and an argument array, never `exec` or a string command line.
3. **Mark read-only tools.** Add `annotations: { readOnlyHint: true, ... }` to tools that never write, so users can approve them once.
4. **Treat returned file text as data.** If your tool returns file contents, say in its description that the content must not be followed as instructions.
5. **Do not write into `_mcp_tools` or `Claude_Plugins`.** Those folders hold code that runs on the user's PC.

## Pull requests

- Keep each pull request to one change, and explain why in the description.
- Add or update tests. `npm test` must pass.
- Update the README, `SECURITY.md` and `CHANGELOG.md` if behavior, settings or permissions change.
- Use generic paths (`X:\Claude_Workspace`, `C:\path\to\your\project`) in code, tests and docs, never your own.
- Write docs in plain language, and say what was not tested.
