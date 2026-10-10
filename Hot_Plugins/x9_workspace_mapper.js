// ============================================================
// X9 WORKSPACE MAPPER - Forge Hot Plugin
// Generates a visual folder and file tree for any workspace.
//
// FULL FILESYSTEM COVERAGE - Every known directory on the X9
// drive is mapped as a routable category.  Descriptions in the
// enum help Claude (and the user) pick the right target.
// ============================================================

import fs from "fs/promises";
import path from "path";
import { X9_ROOT } from "./_shared.js";

// --- TOOL IDENTITY ---
export const toolName = "x9_workspace_mapper";

// --- TOOL SCHEMA ---
export const toolSchema = {
  description:
    "Generates a visual tree of folders AND files for a specific category on the X9 drive. " +
    "Use this BEFORE saving files to see existing structure and avoid creating duplicates. " +
    "Supports two modes: 'tree' (default, full file listing with maxEntries cap) and " +
    "'summary' (fast overview - directory names + file counts + last modified, no recursion). " +
    "Use summary mode for 'root' or any large category. " +
    "Covers the entire X9 filesystem: numbered zones 01–08, archives, MCP tools, " +
    "memory, plugins, chat history, tasks, and code plans.",
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [
          // Top-level folders
          "root",                        // X9_ROOT: top-level overview
          "archive",                     // Archive/: superseded docs moved here to reduce confusion
          "context",                     // _context/: session startup context files
          "mcp_tools",                   // _mcp_tools/: all MCP server source code
          "memory",                      // memory/: persistent context files
          "pre_launch_check",            // Pre_Launch_Check/: reviews and checklists
          "tasks",                       // Tasks/: active task lists
          "skills",                      // skills/: Claude Code skills

          // Numbered zones
          "active_projects",             // 01_Active_Projects/: all active workstreams
          "raw_inputs",                  // 02_Raw_Inputs/: raw reference material (treat as read-only)
          "final_outputs",               // 03_Final_Outputs/: polished deliverables
          "session_notes",               // 04_Session_Notes/: date-prefixed session notes
          "handoff",                     // 05_Claude_Code_Handoff/: briefs for Claude Code
          "code_plans",                  // 06_Code_Plans/: implementation plans written before coding
          "chat_history",                // 07_Chat_History/: Forge action logs, raw dumps and readable exports
          "chat_history_cowork",         // 07_Chat_History/Cowork/: raw Cowork session folders
          "chat_history_readable_logs",  // 07_Chat_History/Readable_Logs/: human-readable markdown exports
          "readable_logs_cowork",        // 07_Chat_History/Readable_Logs/Cowork/: readable Cowork session logs
          "cowork_handoff",              // 08_Cowork_Handoff/: research outputs from Cowork sessions

          // MCP tool folders
          "hot_plugins",                 // _mcp_tools/Hot_Plugins/: Forge hot-swappable plugins
          "the_observer",                // _mcp_tools/The_Observer/: chat history sweeper and flattener
          "readonly_bridge",             // _mcp_tools/readonly_bridge/: read-only codebase bridge
          "the_forge",                   // _mcp_tools/the_forge/: The Forge MCP server

          // Plugins
          "plugins",                     // Claude_Plugins/: installed and in-development plugins
        ],
        description:
          "The workspace category to map. Maps to a physical folder on the X9 drive. " +
          "See inline comments above each enum value for what each category contains.",
      },
      mode: {
        type: "string",
        enum: ["tree", "summary"],
        description:
          "Output mode. 'tree' = full file/folder tree (default). " +
          "'summary' = directories only with file counts and last modified date - " +
          "always fast, even for huge folders like readable_logs_claude_code.",
        default: "tree",
      },
      maxDepth: {
        type: "number",
        description:
          "Maximum directory depth to traverse in tree mode. Default 3. " +
          "Use 1-2 for quick overview, 4 for deep inspection. Ignored in summary mode.",
        default: 3,
        minimum: 1,
        maximum: 4,
      },
      maxEntries: {
        type: "number",
        description:
          "Maximum lines to emit in tree mode. Prevents overflow on large directories. " +
          "Default 300. Ignored in summary mode.",
        default: 300,
        minimum: 10,
        maximum: 1000,
      },
    },
    required: ["category"],
  },
  annotations: { title: "Map workspace folders", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

// --- ROUTE MAP ---
// Each key maps a category enum value to its absolute Windows path.
const routes = {
  // ── Top-Level ──
  root:                    X9_ROOT,
  archive:                 path.join(X9_ROOT, "Archive"),
  context:                 path.join(X9_ROOT, "_context"),
  mcp_tools:               path.join(X9_ROOT, "_mcp_tools"),
  memory:                  path.join(X9_ROOT, "memory"),
  pre_launch_check:        path.join(X9_ROOT, "Pre_Launch_Check"),
  tasks:                   path.join(X9_ROOT, "Tasks"),
  skills:                  path.join(X9_ROOT, "skills"),

  // ── Numbered zones ──
  active_projects:         path.join(X9_ROOT, "01_Active_Projects"),
  raw_inputs:              path.join(X9_ROOT, "02_Raw_Inputs"),
  final_outputs:           path.join(X9_ROOT, "03_Final_Outputs"),
  session_notes:           path.join(X9_ROOT, "04_Session_Notes"),
  handoff:                 path.join(X9_ROOT, "05_Claude_Code_Handoff"),
  code_plans:              path.join(X9_ROOT, "06_Code_Plans"),
  chat_history:                path.join(X9_ROOT, "07_Chat_History"),
  chat_history_cowork:         path.join(X9_ROOT, "07_Chat_History", "Cowork"),
  chat_history_readable_logs:  path.join(X9_ROOT, "07_Chat_History", "Readable_Logs"),
  readable_logs_cowork:        path.join(X9_ROOT, "07_Chat_History", "Readable_Logs", "Cowork"),
  cowork_handoff:          path.join(X9_ROOT, "08_Cowork_Handoff"),

  // ── MCP tool folders ──
  hot_plugins:             path.join(X9_ROOT, "_mcp_tools", "Hot_Plugins"),
  the_observer:            path.join(X9_ROOT, "_mcp_tools", "The_Observer"),
  readonly_bridge:         path.join(X9_ROOT, "_mcp_tools", "readonly_bridge"),
  the_forge:               path.join(X9_ROOT, "_mcp_tools", "the_forge"),

  // ── Plugins ──
  plugins:                 path.join(X9_ROOT, "Claude_Plugins"),
};

// Folders and files to completely ignore during traversal
const IGNORED_ITEMS = new Set([
  "node_modules",
  ".git",
  ".venv",
  "__pycache__",
  ".DS_Store",
  ".claude-plugin",
  ".cursor-plugin",
  ".codex",
  ".opencode",
  ".github",
]);

// --- SUMMARY BUILDER (fast: one readdir + stat per entry, no recursion) ---
async function buildSummary(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return `  [access denied: ${err.code}]\n`;
  }

  const validEntries = entries
    .filter((e) => !IGNORED_ITEMS.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  let output = "";
  for (let i = 0; i < validEntries.length; i++) {
    const entry = validEntries[i];
    const isLast = i === validEntries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      let fileCount = 0;
      let dirCount = 0;
      let lastMod = 0;
      try {
        const children = await fs.readdir(fullPath, { withFileTypes: true });
        for (const child of children) {
          if (IGNORED_ITEMS.has(child.name)) continue;
          if (child.isDirectory()) dirCount++;
          else fileCount++;
          try {
            const st = await fs.stat(path.join(fullPath, child.name));
            if (st.mtimeMs > lastMod) lastMod = st.mtimeMs;
          } catch {}
        }
      } catch {}
      const dateStr = lastMod > 0 ? new Date(lastMod).toISOString().split("T")[0] : "-";
      const fileTxt = fileCount === 1 ? "1 file" : `${fileCount} files`;
      const dirTxt = dirCount === 1 ? "1 subdir" : `${dirCount} subdirs`;
      output += `${connector}${entry.name}/    ${fileTxt} · ${dirTxt} · ${dateStr}\n`;
    } else {
      output += `${connector}${entry.name}\n`;
    }
  }
  return output;
}

// --- RECURSIVE TREE BUILDER (with entry cap) ---
async function buildTree(dirPath, prefix, currentDepth, maxDepth, counter) {
  if (currentDepth >= maxDepth) return "";
  if (counter.count >= counter.max) return "";

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return `${prefix}└── [access denied: ${err.code}]\n`;
  }

  const validEntries = entries
    .filter((e) => !IGNORED_ITEMS.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  let output = "";

  for (let i = 0; i < validEntries.length; i++) {
    if (counter.count >= counter.max) {
      const remaining = validEntries.length - i;
      output += `${prefix}... and ${remaining} more entries (maxEntries reached - increase maxEntries or use summary mode)\n`;
      break;
    }

    const entry = validEntries[i];
    const isLast = i === validEntries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (entry.isDirectory()) {
      output += `${prefix}${connector}${entry.name}/\n`;
      counter.count++;
      output += await buildTree(
        path.join(dirPath, entry.name),
        prefix + childPrefix,
        currentDepth + 1,
        maxDepth,
        counter
      );
    } else {
      output += `${prefix}${connector}${entry.name}\n`;
      counter.count++;
    }
  }

  return output;
}

// --- TOOL HANDLER ---
export const toolHandler = async (args) => {
  const { category, mode = "tree" } = args;
  let { maxDepth = 3, maxEntries = 300 } = args;

  // Clamp numeric inputs to the ranges the schema promises
  maxDepth = Math.max(1, Math.min(4, Number(maxDepth) || 3));
  maxEntries = Math.max(10, Math.min(1000, Number(maxEntries) || 300));

  const rootPath = Object.hasOwn(routes, category) ? routes[category] : undefined;
  if (!rootPath) {
    return {
      error: true,
      message: `Unknown category "${category}". Valid: ${Object.keys(routes).join(", ")}`,
    };
  }

  try {
    await fs.access(rootPath);
  } catch {
    return {
      error: true,
      message: `Category root does not exist: ${rootPath}`,
    };
  }

  const rootName = path.basename(rootPath);
  let tree = `${rootName}/\n`;

  if (mode === "summary") {
    tree += await buildSummary(rootPath);
  } else {
    const counter = { count: 0, max: maxEntries };
    tree += await buildTree(rootPath, "", 0, maxDepth, counter);
    if (counter.count >= counter.max) {
      tree += `\n(Output capped at ${maxEntries} entries. Use mode: "summary" for an overview, or increase maxEntries.)\n`;
    }
  }

  if (tree.trim() === `${rootName}/`) {
    tree += "  (empty directory)\n";
  }

  return {
    category,
    rootPath,
    mode,
    maxDepth,
    ...(mode === "tree" ? { maxEntries } : {}),
    ignored: [...IGNORED_ITEMS],
    tree,
  };
};