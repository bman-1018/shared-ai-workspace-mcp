#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { execFile } from "child_process";
import util from "util";
import { formatLogLine } from "./log_sanitize.js";

const execFilePromise = util.promisify(execFile);

// --- CONFIGURATION ---
// Workspace root on your external drive. Set X9_ROOT in claude_desktop_config.json
// to use a different drive letter or folder (default: X:\Claude_Workspace).
const X9_ROOT = path.resolve(process.env.X9_ROOT || "X:\\Claude_Workspace");
// Sibling folders of this one (the_forge/..): resolved relative to this file so
// the repo works wherever you put it.
const MCP_TOOLS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOT_DIR = path.join(MCP_TOOLS_DIR, "Hot_Plugins");
const OBSERVER_DIR = path.join(MCP_TOOLS_DIR, "The_Observer");
const HISTORY_DIR = path.join(X9_ROOT, "07_Chat_History");

// The action log records every tool call. Set X9_FORGE_LOG=off to turn it off.
const LOG_ENABLED = process.env.X9_FORGE_LOG !== "off";

try {
  if (LOG_ENABLED && !fsSync.existsSync(HISTORY_DIR)) {
    fsSync.mkdirSync(HISTORY_DIR, { recursive: true });
  }
} catch (err) {
  // Drive not plugged in or wrong letter: keep the server alive, just log it.
  console.error(`[Forge] Cannot create ${HISTORY_DIR}: ${err.message}. Check X9_ROOT and that the drive is connected.`);
}

// ====================================================================
// 1. THE FOUNDRY OBSERVER: Passive Action Logger
// ====================================================================
async function logActionToX9(toolName, args, result, isError = false) {
  if (!LOG_ENABLED) return;
  const dateStr = new Date().toISOString().split('T')[0];
  // JSON Lines: one valid JSON object per line.
  const logFile = path.join(HISTORY_DIR, `${dateStr}_Forge_Action_Log.jsonl`);

  const logEntry = {
    timestamp: new Date().toISOString(),
    tool_executed: toolName,
    inputs: args,
    output: result,
    status: isError ? "FAILED" : "SUCCESS"
  };

  try {
    // formatLogLine cuts long strings and redacts secret-looking values.
    await fs.appendFile(logFile, formatLogLine(logEntry), "utf8");
  } catch (err) {
    console.error(`[Forge Observer] Failed to write log: ${err.message}`);
  }
}

// ====================================================================
// 2. THE FOUNDRY OBSERVER: Active Background Sync
// ====================================================================
let syncRunning = false;
async function runActiveSync() {
  // Skip this tick if the previous sweep is still running (prevents overlapping copies)
  if (syncRunning) return;
  syncRunning = true;
  try {
    // Silently executes the sweep and flatten scripts in the background.
    // process.execPath is the exact Node binary running this server, so no PATH lookup
    // and no shell are involved.
    const opts = { cwd: OBSERVER_DIR, timeout: 5 * 60 * 1000, windowsHide: true };
    await execFilePromise(process.execPath, ["vault_sweeper.js"], opts);
    await execFilePromise(process.execPath, ["vault_flattener.js"], opts);
  } catch (err) {
    console.error(`[Forge Observer] Background Sync Error: ${err.message}`);
  } finally {
    syncRunning = false;
  }
}

// ====================================================================
// THE FORGE MCP SERVER
// ====================================================================
let activeTools = new Map();
const server = new Server(
  { name: "the-forge-meta-server", version: "1.4.0-Omnibus" },
  { capabilities: { tools: { listChanged: true } } } 
);

async function loadTools() {
  activeTools.clear();
  try {
    const files = await fs.readdir(HOT_DIR);
    for (const file of files) {
      if (file.endsWith(".js") && !file.startsWith("_")) {
        const filePath = path.join(HOT_DIR, file);
        const fileUrl = pathToFileURL(filePath).href;
        try {
          const module = await import(`${fileUrl}?t=${Date.now()}`);
          if (module.toolName && module.toolSchema && module.toolHandler) {
            activeTools.set(module.toolName, {
              schema: module.toolSchema,
              handler: module.toolHandler
            });
            console.error(`[Forge] Active Tool: ${module.toolName}`);
          }
        } catch (err) {
          console.error(`[Forge] Failed to compile ${file}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[Forge] Error: ${err.message}`);
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];
  for (const [name, tool] of activeTools.entries()) {
    tools.push({ name, description: tool.schema.description, inputSchema: tool.schema.inputSchema });
  }
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = activeTools.get(name);
  if (!tool) throw new Error(`Tool ${name} not found.`);
  
  try {
    const result = await tool.handler(args);
    await logActionToX9(name, args, result);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    await logActionToX9(name, args, error.message, true);
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// ====================================================================
// SYSTEM BOOT & WATCHER
// ====================================================================
async function startSystem() {
  await loadTools();
  
  let watchTimeout = null;
  if (!fsSync.existsSync(HOT_DIR)) {
    console.error(`[Forge] Hot plugin folder not found: ${HOT_DIR}`);
  } else fsSync.watch(HOT_DIR, (eventType, filename) => {
    if (filename && filename.endsWith(".js") && !filename.includes("_temp")) {
      if (watchTimeout) clearTimeout(watchTimeout);
      watchTimeout = setTimeout(async () => {
        console.error(`\n[Forge] File change detected: ${filename}. Recompiling...`);
        await loadTools();
        try {
          server.notification({ method: "notifications/tools/list_changed" });
          console.error(`[Forge] Pinged UI to refresh tools.`);
        } catch (e) {}
      }, 1500); 
    }
  });

  // Start the Background Sync Engine
  // Note: We intentionally do NOT run it immediately on boot to prevent Cowork lock collisions.
  // It will wait exactly 60 seconds before executing the first sweep.
  setInterval(runActiveSync, 60000);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Forge] Connected via pure stdio. Observer Middleware & Active Sync Online.");
}

startSystem();