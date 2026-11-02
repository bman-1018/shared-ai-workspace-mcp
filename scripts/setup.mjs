#!/usr/bin/env node
// Setup for Shared AI Workspace MCP: `npm run setup` (or `node scripts/setup.mjs`).
// Works the same on Windows, macOS and Linux. It:
//   1. checks Node.js,
//   2. creates the workspace folders from workspace_template (never overwrites a file),
//   3. installs the servers' dependencies,
//   4. backs up the Claude Desktop config and adds the server entries with the right paths,
//   5. prints the same entries for Codex and Cline.
// Run with --dry-run first to see what it would do. --help lists every option.
// Only Node built-ins are used, so it runs before anything is installed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultWorkspaceRoot, claudeDataDir } from "../the_forge/platform_paths.js";

export const REPO_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIN_NODE_MAJOR = 22;

// The workspace subfolders the optional file server may use. It lists subfolders, not the
// whole workspace, so Claude cannot add plugins to _mcp_tools (see SECURITY.md).
export const FILE_SERVER_FOLDERS = [
  "_context", "01_Active_Projects", "02_Raw_Inputs", "03_Final_Outputs", "04_Session_Notes",
  "05_Claude_Code_Handoff", "06_Code_Plans", "07_Chat_History", "08_Cowork_Handoff",
  "09_For_Codex", "memory", "Tasks",
];
// Folders the template does not ship but the servers expect.
const EXTRA_FOLDERS = ["07_Chat_History", "08_Cowork_Handoff"];
// Pinned like the example config, so a new release of the file server is a deliberate update.
const FILE_SERVER_PACKAGE = "@modelcontextprotocol/server-filesystem@2026.8.31";

const HELP = `Usage: npm run setup -- [options]

Options:
  --root <folder>      Workspace folder. Default: ${defaultWorkspaceRoot()}
  --codex              Also create a Codex workspace next to it and a read-only entry for it
  --code-dir <folder>  Add the read-only code bridge for this one project folder
  --files              Add the file server entry (read and write in the workspace subfolders)
  --config <file>      Config file to update. Default: Claude Desktop's config for this computer
  --no-config          Do not change any config file; only print the entries
  --skip-install       Do not run npm install
  --semantic           Install the optional semantic search packages (needs Python 3.10+)
  --force              Replace server entries that already exist with the same name
  --yes                Do not ask questions; use the options and defaults
  --dry-run            Show what would happen and change nothing
  --help               Show this help`;

export function parseArgs(argv) {
  const o = { codex: false, files: false, noConfig: false, skipInstall: false, semantic: false, force: false, yes: false, dryRun: false, help: false };
  const needValue = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${flag} needs a value.`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--root": o.root = needValue(i, a); i++; break;
      case "--code-dir": o.codeDir = needValue(i, a); i++; break;
      case "--config": o.config = needValue(i, a); i++; break;
      case "--codex": o.codex = true; break;
      case "--files": o.files = true; break;
      case "--no-config": o.noConfig = true; break;
      case "--skip-install": o.skipInstall = true; break;
      case "--semantic": o.semantic = true; break;
      case "--force": o.force = true; break;
      case "--yes": case "-y": o.yes = true; break;
      case "--dry-run": o.dryRun = true; break;
      case "--help": case "-h": o.help = true; break;
      default: throw new Error(`Unknown option: ${a}. Run with --help to see the options.`);
    }
  }
  return o;
}

export function defaultConfigPath(opts = {}) {
  const dir = claudeDataDir(opts);
  return dir ? path.join(dir, "claude_desktop_config.json") : null;
}

// The server entries for this computer. Paths are absolute and point at this copy of
// the repository, and `command` is the Node binary running this script, so Claude
// Desktop does not depend on PATH (a bare "node" can fail with spawn ENOENT).
export function buildServers({ repoDir = REPO_DIR, root, codexRoot, codeDir, files = false, nodePath = process.execPath, platform = process.platform }) {
  const servers = {};
  const forgeEnv = { X9_ROOT: root };
  if (codexRoot && path.resolve(codexRoot) !== path.resolve(path.dirname(root), "Codex_Workspace")) {
    forgeEnv.X9_CODEX_ROOT = codexRoot;
  }
  servers.The_Forge = { command: nodePath, args: [path.join(repoDir, "the_forge", "index.js")], env: forgeEnv };
  if (codeDir) {
    servers.C_Drive_ReadOnly = {
      command: nodePath,
      args: [path.join(repoDir, "readonly_bridge", "index.js")],
      env: { READONLY_BRIDGE_DIR: codeDir, READONLY_BRIDGE_BLOCK_SECRETS: "1" },
    };
  }
  if (files) {
    const npx = path.join(path.dirname(nodePath), platform === "win32" ? "npx.cmd" : "npx");
    servers.X9_External_Drive = {
      command: npx,
      args: ["-y", FILE_SERVER_PACKAGE, ...FILE_SERVER_FOLDERS.map((f) => path.join(root, f))],
    };
  }
  if (codexRoot) {
    servers.Codex_ReadOnly = {
      command: nodePath,
      args: [path.join(repoDir, "readonly_bridge", "index.js")],
      env: { READONLY_BRIDGE_DIR: codexRoot, READONLY_BRIDGE_BLOCK_SECRETS: "1" },
    };
  }
  return servers;
}

// Adds the entries to a parsed config, keeping everything already there. An entry with the
// same name is left alone unless force is set. Returns a new object; the input is unchanged.
export function mergeServers(config, servers, { force = false } = {}) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("The config file does not contain a JSON object.");
  }
  const existing = config.mcpServers ?? {};
  if (typeof existing !== "object" || Array.isArray(existing)) {
    throw new Error('"mcpServers" in the config file is not an object.');
  }
  const merged = { ...existing };
  const added = [], replaced = [], skipped = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (!(name in existing)) { merged[name] = entry; added.push(name); }
    else if (force) { merged[name] = entry; replaced.push(name); }
    else skipped.push(name);
  }
  return { config: { ...config, mcpServers: merged }, added, replaced, skipped };
}

// Rewrites example paths such as X:\Claude_Workspace\Tasks\tasks.md to the real folder,
// with this computer's separators. The template note telling people to do this by hand is
// dropped, since it no longer applies.
export function replacePaths(text, replacements, pathLib = path) {
  if (!Object.keys(replacements).length) return text;
  let out = text.replace(/^<!-- The paths below assume the workspaces are on X:.*-->\r?\n/m, "");
  for (const [from, to] of Object.entries(replacements)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}((?:\\\\[\\w.-]+)*)(\\\\?)`, "g");
    out = out.replace(re, (_, rest, trailing) => {
      const parts = rest.split("\\").filter(Boolean);
      return pathLib.join(to, ...parts) + (trailing ? pathLib.sep : "");
    });
  }
  return out;
}

// Copies a template folder into dest. Existing files are never overwritten. In new .md
// files, the example paths X:\Claude_Workspace and X:\Codex_Workspace become the real ones.
export function copyTemplate(src, dest, replacements = {}, { dryRun = false } = {}) {
  const created = [];
  const walk = (from, to) => {
    if (!dryRun) fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, e.name);
      const d = path.join(to, e.name);
      if (e.isDirectory()) { walk(s, d); continue; }
      if (!e.isFile() || fs.existsSync(d)) continue;
      created.push(d);
      if (dryRun) continue;
      if (e.name.endsWith(".md")) {
        fs.writeFileSync(d, replacePaths(fs.readFileSync(s, "utf8"), replacements), { flag: "wx" });
      } else {
        fs.copyFileSync(s, d, fs.constants.COPYFILE_EXCL);
      }
    }
  };
  walk(src, dest);
  return created;
}

// Codex CLI reads MCP servers from ~/.codex/config.toml. JSON strings are valid TOML
// basic strings, so JSON.stringify does the quoting.
export function toToml(servers) {
  const q = (s) => JSON.stringify(s);
  return Object.entries(servers).map(([name, s]) => {
    const lines = [`[mcp_servers.${name}]`, `command = ${q(s.command)}`, `args = [${s.args.map(q).join(", ")}]`];
    if (s.env) lines.push(`env = { ${Object.entries(s.env).map(([k, v]) => `${k} = ${q(v)}`).join(", ")} }`);
    return lines.join("\n");
  }).join("\n\n");
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Reads, backs up and updates one config file. Writes to a temporary file first and renames
// it, so a crash cannot leave half a config behind.
export function updateConfigFile(file, servers, { force = false, dryRun = false } = {}) {
  let config = {};
  let backup = null;
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    if (raw.trim()) {
      try { config = JSON.parse(raw); } catch (err) {
        throw new Error(`${file} is not valid JSON (${err.message}). Fix it or pass --no-config; nothing was changed.`);
      }
    }
    backup = `${file}.backup-${timestamp()}`;
  }
  const result = mergeServers(config, servers, { force });
  if (!dryRun && (result.added.length || result.replaced.length)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (backup) fs.copyFileSync(file, backup);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(result.config, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } else {
    backup = null;
  }
  return { ...result, backup };
}

function findPython() {
  for (const cmd of ["python3", "python", "py"]) {
    const r = spawnSync(cmd, ["-c", "import sys, sqlite3; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    if (!r.error && r.status === 0) {
      const [maj, min] = r.stdout.trim().split(".").map(Number);
      if (maj > 3 || (maj === 3 && min >= 10)) return { cmd, version: r.stdout.trim() };
    }
  }
  return null;
}

function run(cmd, args, opts = {}) {
  // npm is npm.cmd on Windows, which Node only starts through a shell. The arguments are
  // fixed strings from this script, never user input.
  const r = spawnSync(cmd, args, { stdio: "inherit", windowsHide: true, shell: process.platform === "win32" && cmd === "npm", ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${r.status}.`);
}

async function ask(o) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = async (text, def) => {
    const a = (await rl.question(def ? `${text} [${def}]: ` : `${text}: `)).trim();
    return a || def || "";
  };
  const yes = async (text, def) => {
    const a = (await q(`${text} (y/n)`, def ? "y" : "n")).toLowerCase();
    return a.startsWith("y");
  };
  try {
    console.log("An external SSD is recommended for the workspace; a folder on your main drive works too.");
    o.root = await q("Workspace folder", o.root || defaultWorkspaceRoot());
    if (!o.codex) o.codex = await yes("Do you also use Codex? Create a Codex workspace next to it", false);
    if (!o.codeDir) o.codeDir = (await q("Folder of one project Claude may read (read-only, blank to skip)", "")) || undefined;
    if (!o.files) o.files = await yes("Add the file server (Claude can read and write the workspace subfolders)", false);
    if (!o.noConfig && !o.config) {
      const def = defaultConfigPath();
      if (def) o.noConfig = !(await yes(`Update the Claude Desktop config at ${def}`, true));
    }
  } finally {
    rl.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) { console.log(HELP); return 0; }

  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE_MAJOR) throw new Error(`Node.js ${MIN_NODE_MAJOR} or newer is needed; this is ${process.version}.`);

  if (!o.yes && process.stdin.isTTY) await ask(o);

  const root = path.resolve(o.root || defaultWorkspaceRoot());
  const codexRoot = o.codex ? path.join(path.dirname(root), "Codex_Workspace") : undefined;
  const codeDir = o.codeDir ? path.resolve(o.codeDir) : undefined;
  const tag = o.dryRun ? "[dry run] " : "";
  console.log(`\n${tag}Workspace: ${root}`);

  // 1. Folders
  try {
    if (!o.dryRun) fs.mkdirSync(root, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create ${root} (${err.code || err.message}). Is the drive connected? Pass --root to choose another folder.`);
  }
  const replacements = { "X:\\Claude_Workspace": root, ...(codexRoot ? { "X:\\Codex_Workspace": codexRoot } : {}) };
  const created = copyTemplate(path.join(REPO_DIR, "workspace_template", "claude"), root, replacements, { dryRun: o.dryRun });
  for (const f of EXTRA_FOLDERS) if (!o.dryRun) fs.mkdirSync(path.join(root, f), { recursive: true });
  console.log(`${tag}Workspace folders ready (${created.length} new files, existing files left as they were).`);
  if (codexRoot) {
    const c = copyTemplate(path.join(REPO_DIR, "workspace_template", "codex"), codexRoot, replacements, { dryRun: o.dryRun });
    console.log(`${tag}Codex workspace ready at ${codexRoot} (${c.length} new files).`);
  }
  if (codeDir && !fs.existsSync(codeDir)) console.log(`Warning: ${codeDir} does not exist yet. The read-only bridge will fail until it does.`);

  // 2. Dependencies
  if (o.skipInstall) console.log("Skipped npm install (--skip-install).");
  else if (o.dryRun) console.log(`${tag}Would run: npm run install:all`);
  else run("npm", ["run", "install:all"], { cwd: REPO_DIR });

  // 3. Search
  const py = findPython();
  if (py) console.log(`Python ${py.version} found: keyword search will work.`);
  else console.log("Python 3.10+ not found: everything works except search. Install Python and restart the app to turn it on.");
  if (o.semantic) {
    if (!py) throw new Error("--semantic needs Python 3.10 or newer.");
    const engine = path.join(REPO_DIR, "x9_search_engine");
    const venvPy = process.platform === "win32" ? path.join(engine, ".venv", "Scripts", "python.exe") : path.join(engine, ".venv", "bin", "python");
    if (o.dryRun) console.log(`${tag}Would create ${path.join(engine, ".venv")} and install requirements-semantic.txt`);
    else {
      if (!fs.existsSync(venvPy)) run(py.cmd, ["-m", "venv", path.join(engine, ".venv")]);
      run(venvPy, ["-m", "pip", "install", "--only-binary=:all:", "-r", path.join(engine, "requirements-semantic.txt")]);
    }
  }

  // 4. Config
  const servers = buildServers({ root, codexRoot, codeDir, files: o.files });
  const configFile = o.noConfig ? null : (o.config ? path.resolve(o.config) : defaultConfigPath());
  if (!o.noConfig && !configFile) console.log("Could not find Claude Desktop's config folder. Pass --config, or copy the entries below by hand.");
  else if (configFile && !o.config && !fs.existsSync(path.dirname(configFile))) {
    console.log(`Claude Desktop does not seem to be installed (no ${path.dirname(configFile)}). Copy the entries below by hand, or pass --config.`);
  } else if (configFile) {
    const r = updateConfigFile(configFile, servers, { force: o.force, dryRun: o.dryRun });
    if (r.backup) console.log(`Backed up the config to ${r.backup}`);
    if (r.added.length) console.log(`${tag}Added to ${configFile}: ${r.added.join(", ")}`);
    if (r.replaced.length) console.log(`${tag}Replaced in ${configFile}: ${r.replaced.join(", ")}`);
    if (r.skipped.length) console.log(`Already in ${configFile}, left unchanged: ${r.skipped.join(", ")} (use --force to replace)`);
  }

  // 5. Other apps
  console.log("\nFor Cline, or any app that takes the same JSON, add these under \"mcpServers\":");
  console.log(JSON.stringify(servers, null, 2));
  console.log("\nFor Codex CLI, add this to ~/.codex/config.toml. In the Codex desktop app, enter the same command, arguments and environment variables under Plugins, MCPs:");
  console.log(toToml(servers));
  console.log(`\nNext: quit the app completely and reopen it, then ask it to "Run hello_forge".`);
  console.log("Details: docs/CONFIGURATION.md. Problems: docs/CONFIGURATION.md#troubleshooting");
  return 0;
}

// Run only when started directly, not when the tests import this file. realpath because
// Node resolves symlinks for import.meta.url (macOS temp folders are symlinks), and a
// case-insensitive compare on Windows, where the drive letter's case can differ.
function isMain() {
  if (!process.argv[1]) return false;
  let a, b;
  try { a = fs.realpathSync(process.argv[1]); b = fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`\nSetup stopped: ${err.message}`);
    process.exitCode = 1;
  });
}
