# Shared AI Workspace MCP: one persistent workspace for Claude, Codex and Cline

[![CI](https://github.com/bman-1018/shared-ai-workspace-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bman-1018/shared-ai-workspace-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6.svg)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-339933.svg)

Every new chat starts from zero, and each AI app keeps its own memory. This repo gives them one shared workspace of plain folders and text files, plus MCP tools to read it, write to it, search it, and save session summaries into it, so context carries over between sessions and between apps.

It works with Claude Desktop, Codex (ChatGPT desktop app) and Cline. Cline lets you run almost any model with your own API key, and the same servers work there. Any other tool that can open a folder can read the same files.

The workspace is designed for an external SSD: it keeps your AI files separate and moves with you between PCs. No external SSD? It works just as well on a partition you set aside for it or in a folder on `C:`. See [Choosing where the workspace lives](docs/CONFIGURATION.md#choosing-where-the-workspace-lives).

Why "X9"? The settings and tool names (`X9_ROOT`, `x9_search`, `X9_External_Drive`) come from the Crucial X9 SSD this was first built on. Any drive works.

Windows only. It does not connect web clients (ChatGPT, claude.ai). Not affiliated with Anthropic or OpenAI.

## Quick start

**You need:** Windows 10/11, an external SSD or other place for the workspace (the steps use `X:\Claude_Workspace`; for `C:` or another drive letter, see [Choosing where the workspace lives](docs/CONFIGURATION.md#choosing-where-the-workspace-lives)), [Node.js](https://nodejs.org) 22+, and optionally [Python](https://www.python.org) 3.10+ (search) and [Git](https://git-scm.com).

**1. Get the code and create the folders.** In Command Prompt:

```
git clone https://github.com/bman-1018/shared-ai-workspace-mcp.git X:\Claude_Workspace\_mcp_tools
xcopy /E /I X:\Claude_Workspace\_mcp_tools\workspace_template\claude X:\Claude_Workspace
mkdir X:\Claude_Workspace\07_Chat_History X:\Claude_Workspace\08_Cowork_Handoff
cd /d X:\Claude_Workspace\_mcp_tools
npm run install:all
```

No Git? Download the ZIP from GitHub and extract it to `X:\Claude_Workspace\_mcp_tools` instead.

**2. Edit the Claude Desktop config.** Press **Win + R**, enter `%APPDATA%\Claude`, and open `claude_desktop_config.json` (create it if missing). Add this inside `mcpServers`:

```json
"The_Forge": {
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["X:\\Claude_Workspace\\_mcp_tools\\the_forge\\index.js"],
  "env": { "X9_ROOT": "X:\\Claude_Workspace" }
}
```

- Every backslash in a path is doubled.
- If Node.js is installed elsewhere, change `command` to its full path.
- If the file already has servers, add a comma between entries.

**3. Restart Claude Desktop completely.** Right-click the tray icon and choose **Quit**, then reopen. **Settings, Developer** should show `The_Forge` as running.

**4. Try it.** Ask Claude "Run hello_forge", then "Map the root of my workspace."

That gives you the Forge: search, session summaries, plan files and chunked saving. The other three servers are optional and are already filled in for you in [`claude_desktop_config.example.json`](claude_desktop_config.example.json):

| Server | Adds | Change before using |
|---|---|---|
| `X9_External_Drive` | General read and write on the workspace subfolders | Nothing. Needs the folders from step 1. |
| `C_Drive_ReadOnly` | Claude can read one codebase, plus `git status`, `diff`, `log`, `branch` | Set `READONLY_BRIDGE_DIR` to that folder |
| `Codex_ReadOnly` | Claude can read `X:\Codex_Workspace` | Delete it if you do not use Codex |

Using Codex (ChatGPT desktop app) or Cline instead? The same entries work there. See [Other apps](docs/CONFIGURATION.md#other-apps-codex-and-cline).

Stuck? See [Troubleshooting](docs/CONFIGURATION.md#troubleshooting). Prefer to have an AI agent do the setup? Use [AGENT_SETUP.md](AGENT_SETUP.md).

## Security

Read [SECURITY.md](SECURITY.md) before using this.

- The Forge runs every plugin in `Hot_Plugins` with your user rights. Treat that folder like your startup folder.
- Every tool call is logged to `07_Chat_History`. Secret-looking values are hidden on a best-effort basis, so keep secrets off this drive.
- Local servers have no authentication, which is why web clients are unsupported on purpose.
- The security review was done by the author, not an independent party.

## Documentation

| Document | Contents |
|---|---|
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Config walkthrough, every setting, folder layout, what each part does, search, Codex, troubleshooting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, tests, rules for plugins |
| [docs/ENGINEERING_NOTES.md](docs/ENGINEERING_NOTES.md) | Design trade-offs |
| [SECURITY.md](SECURITY.md) | Threat model and review findings |
| [CHANGELOG.md](CHANGELOG.md) | What changed |

`npm test` runs the test suite, which uses temporary folders. The full setup has not yet been run end to end on a clean Windows machine, so please report anything that behaves differently on yours.

MIT licensed. See [LICENSE](LICENSE).
