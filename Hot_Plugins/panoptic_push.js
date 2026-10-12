import fs from "fs/promises";
import path from "path";
import fsSync from "fs";
import { X9_ROOT, HOT_PLUGINS_DIR, resolveInside } from "./_shared.js";

export const toolName = "panoptic_push";

// Folders the AI may write into (all paths hang off X9_ROOT, see _shared.js).
const routes = {
  context: path.join(X9_ROOT, "_context"),
  active_projects: path.join(X9_ROOT, "01_Active_Projects"),
  raw_inputs: path.join(X9_ROOT, "02_Raw_Inputs"),
  final_outputs: path.join(X9_ROOT, "03_Final_Outputs"),
  session_notes: path.join(X9_ROOT, "04_Session_Notes"),
  handoff: path.join(X9_ROOT, "05_Claude_Code_Handoff"),
  code_plans: path.join(X9_ROOT, "06_Code_Plans"),
  memory: path.join(X9_ROOT, "memory"),
  pre_launch: path.join(X9_ROOT, "Pre_Launch_Check")
};

// SECURITY: these two routes let the AI add code that runs on your computer
// (a file in _mcp_tools or Claude_Plugins can become a tool or a plugin).
// They are OFF unless you set X9_ALLOW_PLUGIN_WRITE=1 in the server's env block.
// The setting is read once when the Forge starts, so restart after changing it.
if (process.env.X9_ALLOW_PLUGIN_WRITE === "1") {
  routes.mcp_tools = path.join(X9_ROOT, "_mcp_tools");
  routes.plugins = path.join(X9_ROOT, "Claude_Plugins");
}

export const toolSchema = {
  description: "Bypass standard file size limits by writing large files in chunks. Use this for files larger than 25kb.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "The name of the file to save (e.g., docs.md)" },
      category: { 
        type: "string", 
        enum: Object.keys(routes),
        description: "The X9 drive folder to route this file to."
      },
      chunk_data: { type: "string", description: "The text chunk to write. Keep under 25,000 characters." },
      is_first_chunk: { type: "boolean", description: "True if this is the first chunk (creates/overwrites file)." },
      is_final_chunk: { type: "boolean", description: "True if this is the last chunk (finalizes the transfer)." }
    },
    required: ["filename", "category", "chunk_data", "is_first_chunk", "is_final_chunk"]
  },
  // Writes files and can replace an existing file of the same name, so it is not read only.
  annotations: { title: "Write large file in chunks", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
};

const TEMP_DIR = path.join(HOT_PLUGINS_DIR, "_temp");

// Safety limits (generous, but they stop a runaway transfer from filling the drive)
const MAX_CHUNK_CHARS = 200_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const toolHandler = async (args) => {
  const { filename, category, chunk_data, is_first_chunk, is_final_chunk } = args;
  
  if (!fsSync.existsSync(TEMP_DIR)) {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  }

  const targetDir = Object.hasOwn(routes, category) ? routes[category] : undefined;
  if (!targetDir) throw new Error(`Invalid category: ${category}`);
  if (typeof chunk_data !== "string" || chunk_data.length > MAX_CHUNK_CHARS) {
    throw new Error(`chunk_data must be a string of at most ${MAX_CHUNK_CHARS} characters.`);
  }

  // SECURITY: filename may include sub-folders ("docs/notes.md") but can never
  // escape the category folder (no "..", no absolute paths, no drive letters).
  const finalPath = resolveInside(targetDir, filename);
  // The temp name is flattened and prefixed with the category so two files with
  // the same name in different categories can't overwrite each other's chunks.
  const tempPath = resolveInside(TEMP_DIR, `${category}__${filename.replace(/[\\/]/g, "__")}.part`);

  try {
    // 1. Write or Append to the temporary file
    if (is_first_chunk) {
      await fs.writeFile(tempPath, chunk_data, "utf8");
    } else {
      await fs.appendFile(tempPath, chunk_data, "utf8");
    }
    if ((await fs.stat(tempPath)).size > MAX_FILE_BYTES) {
      await fs.unlink(tempPath);
      throw new Error(`File exceeds the ${MAX_FILE_BYTES} byte limit and was discarded.`);
    }

    // 2. If it's the last chunk, move it to the final destination
    if (is_final_chunk) {
      if (!fsSync.existsSync(path.dirname(finalPath))) {
        await fs.mkdir(path.dirname(finalPath), { recursive: true });
      }
      
      await fs.copyFile(tempPath, finalPath);
      await fs.unlink(tempPath);
      
      return { status: "Success", message: `File assembled from its chunks and saved to ${finalPath}` };
    }

    // 3. Acknowledge chunk receipt
    return { status: "Processing", message: `Chunk received successfully. Send the next chunk.` };

  } catch (err) {
    return { error: true, message: `Panoptic Push failed: ${err.message}` };
  }
};