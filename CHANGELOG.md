# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `npm run setup`: one setup script for Windows, macOS and Linux. It creates the workspace from the template without overwriting files, installs dependencies, backs up the Claude Desktop config and adds the server entries with full paths, and prints the same entries for Codex and Cline. `--dry-run` shows the plan without changing anything.
- macOS and Linux: the default workspace is `~/AI_Workspace/Claude_Workspace` outside Windows, and the Observer reads Claude Desktop's folder on macOS (`X9_CLAUDE_DATA_DIR` overrides it). Tested in CI only so far.
- CI runs on macOS as well as Linux and Windows, with an end-to-end test that runs the setup, starts the Forge from the written config, and saves and finds a session summary.
- `docs/USE_CASES.md`: short walkthroughs of handing work between Claude and Codex, keeping local files off GitHub, and finding old context with search.
- Optional semantic search for `x9_search`, running entirely on your PC: a small open embedding model (bge-small-en-v1.5) through onnxruntime, embeddings stored in `x9_vectors.db` and reused for unchanged files, hybrid ranking that merges keyword and semantic results, a `mode` option (`hybrid`, `keyword`, `semantic`), and a resumable first build that the Forge continues in the background. Install with `x9_search_engine/requirements-semantic.txt`; without it search stays keyword only.
- `save_session_summary` and `find_sessions`: written summaries of conversations, saved by Claude and read from both the Claude and Codex workspaces.
- The search index rebuilds itself in the background (`X9_INDEX_REFRESH_HOURS`, `X9_INDEX_STARTUP_DELAY_MS`) and is swapped in atomically.
- Server instructions that tell the client when to use the workspace tools.
- Tool annotations (`readOnlyHint` and others) on every tool, plus an optional `Hot_Plugins/_annotations.json`.
- Python is found by trying `python`, `py` and `python3` (`X9_PYTHON` still overrides).
- `docs/ENGINEERING_NOTES.md`, `CONTRIBUTING.md`, issue and pull request templates.

### Security
- Transitive dependencies in `the_forge` and `readonly_bridge` updated (`body-parser`, `zod`, `fast-uri`, `ip-address`) so `npm audit` reports 0 again.

### Fixed
- The Observer's copy step had a typo in its default folder (`X:Claude_Workspace`, missing the backslash). It only mattered when `X9_ROOT` was not set.

### Changed
- Docs name Cline next to Claude Desktop and Codex, recommend an external SSD while saying a dedicated partition or a folder on `C:` also works, explain the "X9" name, and cover moving off `X:`, making a partition, and avoiding OneDrive-synced folders.
- Search: every word matches in any order, file names are searched, quoted phrases work, results show a date and a marked snippet, and the tool warns when the index is old. The Codex workspace is indexed.
- The Forge action log and raw chat copies are no longer indexed; readable chat exports are.
- Tool descriptions and log messages use plain language (no behavior change; tool names are unchanged).
- The Observer scripts report copy and conversion errors to the Forge log instead of ignoring them.
- Docs say plainly that the project does not connect Codex or web-based clients, how a local Codex can reach the drive, and why remote access through a tunnel is not supported.

- Node.js 22 or newer is required (Node 20 reached end of life in April 2026); CI tests Node 22 and 24.

### Removed
- Dead, commented-out Claude Code sync code from the Observer.

## [1.0.0] - 2026-10-09

First release.

- `the_forge` plugin host with hot reload, action log with redaction, and background chat-log sync.
- Plugins: `panoptic_push`, `submit_code_plan`, `x9_search`, `x9_workspace_mapper`, `hello_forge`.
- `readonly_bridge` for one folder plus four read-only git commands.
- `The_Observer` for Cowork chat logs.
- Fixes from the pre-release security review: path traversal in `panoptic_push`, command injection in the search plugin, a path prefix bug in the bridge, and 28 dependency vulnerabilities. See [SECURITY.md](SECURITY.md).
- Safer defaults: plugin writing off, secret blocking on, size limits, and an example config that keeps the file server out of the code folders.

[Unreleased]: https://github.com/bman-1018/shared-ai-workspace-mcp/compare/d726410...HEAD
[1.0.0]: https://github.com/bman-1018/shared-ai-workspace-mcp/commit/d726410
