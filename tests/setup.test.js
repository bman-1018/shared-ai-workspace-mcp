import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseArgs, buildServers, mergeServers, replacePaths, toToml, FILE_SERVER_FOLDERS,
} from "../scripts/setup.mjs";
import { startServer } from "./helpers/mcp_stdio.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SETUP = path.join(REPO, "scripts", "setup.mjs");
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-setup-"));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const runSetup = (args) => spawnSync(process.execPath, [SETUP, "--yes", "--skip-install", ...args], { encoding: "utf8", windowsHide: true });

test("options are parsed and unknown or incomplete ones are refused", () => {
  const o = parseArgs(["--root", "/w", "--codex", "--files", "--dry-run", "--yes"]);
  assert.equal(o.root, "/w");
  assert.equal(o.codex && o.files && o.dryRun && o.yes, true);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
  assert.throws(() => parseArgs(["--root"]), /needs a value/);
  assert.throws(() => parseArgs(["--root", "--codex"]), /needs a value/);
});

test("server entries use absolute paths and the running Node binary", () => {
  const s = buildServers({ repoDir: "/repo", root: "/ws/Claude_Workspace", codexRoot: "/ws/Codex_Workspace", codeDir: "/code", files: true, nodePath: "/bin/node", platform: "linux" });
  assert.deepEqual(Object.keys(s), ["The_Forge", "C_Drive_ReadOnly", "X9_External_Drive", "Codex_ReadOnly"]);
  assert.equal(s.The_Forge.command, "/bin/node");
  assert.deepEqual(s.The_Forge.args, [path.join("/repo", "the_forge", "index.js")]);
  // The Codex workspace is the default sibling, so no X9_CODEX_ROOT is needed.
  assert.deepEqual(s.The_Forge.env, { X9_ROOT: "/ws/Claude_Workspace" });
  assert.equal(s.C_Drive_ReadOnly.env.READONLY_BRIDGE_DIR, "/code");
  assert.equal(s.Codex_ReadOnly.env.READONLY_BRIDGE_DIR, "/ws/Codex_Workspace");
  assert.equal(s.X9_External_Drive.args.length, 2 + FILE_SERVER_FOLDERS.length);
  assert.ok(!s.X9_External_Drive.args.some((a) => a.endsWith("_mcp_tools")), "the file server must not reach the plugin folder");
  const win = buildServers({ repoDir: "C:\\r", root: "X:\\Claude_Workspace", files: true, nodePath: "C:\\node\\node.exe", platform: "win32" });
  assert.match(win.X9_External_Drive.command, /npx\.cmd$/);
  assert.deepEqual(Object.keys(win), ["The_Forge", "X9_External_Drive"]);
});

test("merging keeps existing servers and settings and does not replace by default", () => {
  const config = { globalShortcut: "Ctrl+Space", mcpServers: { Other: { command: "x" }, The_Forge: { command: "old" } } };
  const servers = { The_Forge: { command: "new", args: [] }, Codex_ReadOnly: { command: "n", args: [] } };
  const r = mergeServers(config, servers);
  assert.deepEqual(r.added, ["Codex_ReadOnly"]);
  assert.deepEqual(r.skipped, ["The_Forge"]);
  assert.equal(r.config.mcpServers.The_Forge.command, "old");
  assert.equal(r.config.mcpServers.Other.command, "x");
  assert.equal(r.config.globalShortcut, "Ctrl+Space");
  assert.equal(config.mcpServers.Codex_ReadOnly, undefined, "the input must not be changed");
  const f = mergeServers(config, servers, { force: true });
  assert.deepEqual(f.replaced, ["The_Forge"]);
  assert.equal(f.config.mcpServers.The_Forge.command, "new");
  assert.deepEqual(mergeServers({}, servers).added, ["The_Forge", "Codex_ReadOnly"]);
  assert.throws(() => mergeServers([], servers), /JSON object/);
  assert.throws(() => mergeServers({ mcpServers: [] }, servers), /not an object/);
});

test("template paths are rewritten with this computer's separators", () => {
  const text = "<!-- The paths below assume the workspaces are on X:. If yours are elsewhere, replace. -->\nUse `X:\\Claude_Workspace\\Tasks\\tasks.md` and `X:\\Claude_Workspace\\`.\nCodex: X:\\Codex_Workspace\\02_Outbox";
  const posix = replacePaths(text, { "X:\\Claude_Workspace": "/home/a/ws", "X:\\Codex_Workspace": "/home/a/cx" }, path.posix);
  assert.equal(posix, "Use `/home/a/ws/Tasks/tasks.md` and `/home/a/ws/`.\nCodex: /home/a/cx/02_Outbox");
  const win = replacePaths("`X:\\Claude_Workspace\\Tasks\\tasks.md`", { "X:\\Claude_Workspace": "D:\\Claude_Workspace" }, path.win32);
  assert.equal(win, "`D:\\Claude_Workspace\\Tasks\\tasks.md`");
  assert.equal(replacePaths("X:\\Claude_Workspace", {}), "X:\\Claude_Workspace");
});

test("the Codex snippet is valid-looking TOML with quoted Windows paths", () => {
  const toml = toToml({ The_Forge: { command: "C:\\node\\node.exe", args: ["C:\\r\\the_forge\\index.js"], env: { X9_ROOT: "X:\\Claude_Workspace" } } });
  assert.equal(toml, '[mcp_servers.The_Forge]\ncommand = "C:\\\\node\\\\node.exe"\nargs = ["C:\\\\r\\\\the_forge\\\\index.js"]\nenv = { X9_ROOT = "X:\\\\Claude_Workspace" }');
});

test("a config file that is not valid JSON is left untouched", () => {
  const cfg = path.join(ROOT, "broken", "claude_desktop_config.json");
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, "{ not json");
  const r = runSetup(["--root", path.join(ROOT, "broken", "ws"), "--config", cfg]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.equal(fs.readFileSync(cfg, "utf8"), "{ not json");
  assert.deepEqual(fs.readdirSync(path.dirname(cfg)).filter((f) => f.includes("backup")), []);
});

test("--dry-run changes nothing", () => {
  const ws = path.join(ROOT, "dry", "ws");
  const cfg = path.join(ROOT, "dry", "cfg.json");
  const r = runSetup(["--dry-run", "--root", ws, "--codex", "--config", cfg]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(ROOT, "dry")));
});

test("end to end: setup creates the workspace and config, and the configured Forge saves and finds a session", async () => {
  const ws = path.join(ROOT, "e2e", "Claude_Workspace");
  const cfg = path.join(ROOT, "e2e", "config", "claude_desktop_config.json");
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { Other: { command: "x" } } }));

  execFileSync(process.execPath, [SETUP, "--yes", "--skip-install", "--root", ws, "--codex", "--config", cfg], { stdio: "pipe", windowsHide: true });

  for (const d of ["04_Session_Notes", "07_Chat_History", "08_Cowork_Handoff", "09_For_Codex", "Tasks"]) {
    assert.ok(fs.statSync(path.join(ws, d)).isDirectory(), `missing ${d}`);
  }
  const agents = fs.readFileSync(path.join(ROOT, "e2e", "Codex_Workspace", "AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /X:\\/);
  assert.ok(agents.includes(path.join(ROOT, "e2e", "Codex_Workspace")));
  const config = JSON.parse(fs.readFileSync(cfg, "utf8"));
  assert.deepEqual(Object.keys(config.mcpServers), ["Other", "The_Forge", "Codex_ReadOnly"]);
  assert.equal(fs.readdirSync(path.dirname(cfg)).filter((f) => f.includes(".backup-")).length, 1);

  // Start the Forge exactly as the config says, the way Claude Desktop would.
  const forge = config.mcpServers.The_Forge;
  assert.equal(forge.command, process.execPath);
  const srv = startServer(forge.args, { env: { ...forge.env, X9_INDEX_REFRESH_HOURS: "0" } });
  try {
    await srv.init();
    const hello = await srv.callTool("hello_forge", {});
    assert.equal(hello.isError, false, hello.text);
    const saved = await srv.callTool("save_session_summary", {
      title: "Setup end to end check", summary: "Saved by the setup test.", tags: ["setup-e2e"],
    });
    assert.equal(saved.isError, false, saved.text);
    const found = await srv.callTool("find_sessions", { query: "setup-e2e" });
    assert.equal(found.isError, false, found.text);
    assert.match(found.text, /Setup end to end check/);
    assert.equal(fs.readdirSync(path.join(ws, "04_Session_Notes")).filter((f) => /setup/i.test(f)).length, 1);
  } finally {
    srv.stop();
  }
});
