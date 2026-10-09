// ============================================================
// X9 PYTHON BRIDGE - Forge Hot Plugin
// Zero-Dependency, Offline Keyword Search (SQLite FTS5)
// ============================================================

import { execFile } from "child_process";
import path from "path";
import util from "util";
import { MCP_TOOLS_DIR } from "./_shared.js";

const execFilePromise = util.promisify(execFile);

export const toolName = "x9_search";

export const toolSchema = {
  description: 
    "Fast keyword search across the indexed files of the workspace (SQLite FTS5, substring match, not semantic). " +
    "Use this to find context, documentation, or exact code snippets. " +
    "Returns the file path and surrounding context. " +
    "If you cannot find what you need, use panoptic_push to compile a new Markdown wiki file.",
  inputSchema: {
    type: "object",
    properties: {
      query: { 
        type: "string", 
        description: "The keyword or phrase to search for (e.g., 'deploy checklist', 'meeting notes')." 
      }
    },
    required: ["query"]
  }
};

const PYTHON_SCRIPT = path.join(MCP_TOOLS_DIR, "x9_search_engine", "x9_query.py");
// Set X9_PYTHON in claude_desktop_config.json if "python" is not on your PATH (for example "py").
const PYTHON_EXE = process.env.X9_PYTHON || "python";

export const toolHandler = async (args) => {
  const { query } = args;

  if (typeof query !== "string" || query.trim() === "" || query.length > 500) {
    return { error: true, message: "query must be a non-empty string of at most 500 characters." };
  }
  
  try {
    // SECURITY: execFile passes the query as a single argument and never starts a
    // shell, so cmd.exe metacharacters (& | ^ % ") in the query cannot run commands.
    const { stdout } = await execFilePromise(PYTHON_EXE, [PYTHON_SCRIPT, query], {
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true,
    });
    const results = JSON.parse(stdout);
    
    if (results.error) {
      return { error: true, message: `Python Index Error: ${results.error}` };
    }
    
    if (results.length === 0) {
      return { status: "No Results", message: `No files found matching '${query}'.` };
    }

    return {
      status: "Success",
      matches: results
    };

  } catch (error) {
    return { error: true, message: `Bridge execution failed: ${error.message}` };
  }
};