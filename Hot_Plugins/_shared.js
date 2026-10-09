// ============================================================
// SHARED HELPERS for Forge hot plugins
// The leading underscore keeps The Forge from loading this file
// as a tool. Plugins import it directly.
// ============================================================

import path from "path";
import { fileURLToPath } from "url";

// Root of your workspace on the external drive. Override with the X9_ROOT
// environment variable (set it in claude_desktop_config.json).
export const X9_ROOT = path.resolve(process.env.X9_ROOT || "X:\\Claude_Workspace");

// This folder (Hot_Plugins) and its parent (the _mcp_tools folder).
export const HOT_PLUGINS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MCP_TOOLS_DIR = path.dirname(HOT_PLUGINS_DIR);

/**
 * Resolve a user/AI supplied relative path and guarantee it stays inside baseDir.
 * Rejects absolute paths, drive letters, ".." escapes, NUL bytes, alternate data
 * streams (":") and characters Windows does not allow in file names.
 * pathLib is injectable so the Windows rules can be tested on any OS.
 */
export function resolveInside(baseDir, relPath, pathLib = path) {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new Error("Path must be a non-empty string.");
  }
  if (relPath.includes("\0") || /[:<>"|?*]/.test(relPath)) {
    throw new Error(`Path contains characters that are not allowed: ${relPath}`);
  }
  if (pathLib.isAbsolute(relPath) || /^[\\/]/.test(relPath)) {
    throw new Error(`Absolute paths are not allowed: ${relPath}`);
  }
  const base = pathLib.resolve(baseDir);
  const resolved = pathLib.resolve(base, relPath);
  const rel = pathLib.relative(base, resolved);
  if (rel === "" || rel === ".." || rel.startsWith(".." + pathLib.sep) || pathLib.isAbsolute(rel)) {
    throw new Error(`Path escapes the allowed folder: ${relPath}`);
  }
  return resolved;
}
