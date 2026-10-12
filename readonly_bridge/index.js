#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import util from "util";

const execFilePromise = util.promisify(execFile);

// The one folder (usually a codebase) this bridge may read.
// Set READONLY_BRIDGE_DIR in claude_desktop_config.json (there is no default on purpose).
const configuredDir = process.env.READONLY_BRIDGE_DIR;
if (!configuredDir) {
  console.error("READONLY_BRIDGE_DIR is not set. Add it to the env block of this server in claude_desktop_config.json.");
  process.exit(1);
}
const ALLOWED_DIR = path.resolve(configuredDir);
// Real path (symlinks and junctions resolved), used to stop links inside the folder
// from pointing the bridge at files outside of it.
const ALLOWED_REAL = await fs.realpath(ALLOWED_DIR);

// ON by default: refuses .env files, private keys, .npmrc and .git internals.
// Set READONLY_BRIDGE_BLOCK_SECRETS=0 only if you understand the risk.
// This is a file name filter, not a guarantee. Keep real secrets out of the folder.
const BLOCK_SECRETS = process.env.READONLY_BRIDGE_BLOCK_SECRETS !== "0";

// Size limits so one request cannot flood the AI's context or stall the server.
// Override with READONLY_BRIDGE_MAX_FILE_BYTES / READONLY_BRIDGE_MAX_TOTAL_BYTES if needed.
function readLimit(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
const MAX_FILE_BYTES = readLimit("READONLY_BRIDGE_MAX_FILE_BYTES", 512 * 1024);
const MAX_TOTAL_BYTES = readLimit("READONLY_BRIDGE_MAX_TOTAL_BYTES", 2 * 1024 * 1024);
const MAX_INGEST_FILES = 50;
const SECRET_PATTERN = /(^|[\\/])(\.env(\..*)?|id_rsa.*|id_ed25519.*|.*\.(pem|key|pfx|p12)|\.npmrc|\.git[\\/].*)$/i;

// startsWith() alone is not enough: "C:\\app" is a prefix of "C:\\app-secrets".
// path.relative() compares whole path segments.
function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

// Resolve a requested path, enforce the lock, follow symlinks, and apply the optional secret filter.
async function safeResolve(requested) {
  const lexical = path.resolve(ALLOWED_DIR, requested || ".");
  if (!isInside(ALLOWED_DIR, lexical)) {
    throw new Error("SECURITY VIOLATION: Access denied.");
  }
  const real = await fs.realpath(lexical);
  if (!isInside(ALLOWED_REAL, real)) {
    throw new Error("SECURITY VIOLATION: Access denied.");
  }
  if (BLOCK_SECRETS && SECRET_PATTERN.test(path.relative(ALLOWED_REAL, real))) {
    throw new Error("SECURITY VIOLATION: This file type is blocked (set READONLY_BRIDGE_BLOCK_SECRETS=0 to allow).");
  }
  return real;
}

// Read one text file with a size limit. Rejects folders and binary files.
async function readTextLimited(realPath, maxBytes = MAX_FILE_BYTES) {
  const st = await fs.stat(realPath);
  if (!st.isFile()) throw new Error("Not a file.");
  if (st.size > maxBytes) {
    throw new Error(`File is ${st.size} bytes, over the ${maxBytes} byte limit.`);
  }
  const buf = await fs.readFile(realPath);
  if (buf.subarray(0, 8192).includes(0)) throw new Error("Binary file, not shown.");
  return buf.toString("utf-8");
}

const server = new Server(
  { name: "x9-readonly-bridge", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

// Register ONLY read-based tools. 
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_shadow_file",
      description: "Read the contents of a local codebase file. STRICTLY READ ONLY.",
      inputSchema: {
        type: "object",
        properties: { target_path: { type: "string", description: "The relative path to the file, e.g., src/routes.js" } },
        required: ["target_path"],
      },
    },
    {
      name: "list_shadow_directory",
      description: "List all files and folders in the local codebase.",
      inputSchema: {
        type: "object",
        properties: { target_path: { type: "string", description: "The relative path to the folder, use . for root" } },
        required: ["target_path"],
      },
    },
    {
      name: "panoptic_shadow_ingest",
      description: "Read several files from the local codebase in one call (up to 50 files and 2 MB in total) and return them concatenated, each under a FILE: header. Faster than reading files one at a time. STRICTLY READ ONLY.",
      inputSchema: {
        type: "object",
        properties: { 
          target_paths: { 
            type: "array", 
            items: { type: "string" },
            description: "An array of relative file paths to read simultaneously" 
          } 
        },
        required: ["target_paths"],
      },
    },
    {
      name: "git_shadow_reader",
      description: "Read-only Git tool to check the local codebase's git status, diffs, and recent commits. NO WRITE OR PUSH COMMANDS ALLOWED.",
      inputSchema: {
        type: "object",
        properties: {
          command: { 
            type: "string", 
            enum: ["status", "diff", "log -n 5", "branch"], 
            description: "The safe git command to run" 
          }
        },
        required: ["command"],
      },
    }
  ].map((t) => ({
    ...t,
    // Every tool here only reads. This is a hint to the client (for example, so it can
    // group read-only tools in its permission settings); the code enforces it, not the hint.
    annotations: { title: t.name, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  })),
}));

// Execution Logic
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    // --- TOOL 1: SINGLE FILE READ ---
    if (name === "read_shadow_file") {
      const requestedPath = await safeResolve(args.target_path);
      const content = await readTextLimited(requestedPath);
      return { content: [{ type: "text", text: content }] };
    } 
    
    // --- TOOL 2: DIRECTORY LISTING ---
    if (name === "list_shadow_directory") {
      const requestedPath = await safeResolve(args.target_path);
      const files = await fs.readdir(requestedPath);
      return { content: [{ type: "text", text: files.join("\n") }] };
    }

    // --- TOOL 3: MULTI-FILE READ ---
    if (name === "panoptic_shadow_ingest") {
      const pathsArray = args.target_paths || [];
      if (!Array.isArray(pathsArray)) {
        throw new Error("target_paths must be an array of strings.");
      }

      if (pathsArray.length > MAX_INGEST_FILES) {
        throw new Error(`Too many files: ${pathsArray.length} (limit ${MAX_INGEST_FILES}).`);
      }
      let totalBytes = 0;
      let combinedOutput = "=== MULTI-FILE READ ===\n";
      for (const relativePath of pathsArray) {
        if (typeof relativePath !== "string") {
          combinedOutput += "\n[SKIPPED] A path was not a string.\n";
          continue;
        }
        let requestedPath;
        try {
          requestedPath = await safeResolve(relativePath);
        } catch (error) {
          combinedOutput += `\n[SECURITY LOCK] ERROR: ${relativePath} is outside the allowed read-only directory or blocked.\n`;
          continue; 
        }
        try {
          const content = await readTextLimited(requestedPath, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes));
          totalBytes += Buffer.byteLength(content);
          combinedOutput += `\n================================================================================\nFILE: ${relativePath}\n================================================================================\n\n${content}\n`;
        } catch (error) {
          combinedOutput += `\n[READ ERROR] Could not read ${relativePath} (${error.message})\n`;
        }
      }
      combinedOutput += `\n=== END OF MULTI-FILE READ ===`;
      return { content: [{ type: "text", text: combinedOutput }] };
    }

    // --- TOOL 4: GIT SHADOW READER ---
    if (name === "git_shadow_reader") {
      // Fixed argument lists (no shell, no user-controlled text reaches git).
      const allowedCommands = {
        "status": ["status"],
        "diff": ["diff", "--no-ext-diff", "--no-textconv"],
        "log -n 5": ["log", "-n", "5"],
        "branch": ["branch"],
      };
      if (!Object.hasOwn(allowedCommands, args.command)) {
        throw new Error("SECURITY VIOLATION: Read-only git commands only.");
      }
      try {
        // Runs the native Git command inside the allowed codebase.
        // core.fsmonitor=false stops a repo-level config from launching a helper program.
        const { stdout, stderr } = await execFilePromise(
          "git",
          ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", ...allowedCommands[args.command]],
          { cwd: ALLOWED_DIR, timeout: 30000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }
        );
        return { content: [{ type: "text", text: stdout || stderr || "No output." }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Git command failed: ${error.message}` }], isError: true };
      }
    }

    throw new Error(`Tool ${name} not found.`);
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// Boot the bridge
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[Read-only bridge] Running on stdio. Allowed folder: ${ALLOWED_DIR}`);