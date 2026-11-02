// ============================================================
// SHARED HELPERS for Forge hot plugins
// The leading underscore keeps The Forge from loading this file
// as a tool. Plugins import it directly.
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Root of your workspace (any folder or drive). Override with the X9_ROOT
// environment variable (set it in claude_desktop_config.json).
export const X9_ROOT = path.resolve(process.env.X9_ROOT || "X:\\Claude_Workspace");

// The Codex workspace, a sibling of the Claude workspace. Claude only ever reads it.
// Override with X9_CODEX_ROOT.
export const CODEX_ROOT = path.resolve(
  process.env.X9_CODEX_ROOT || path.join(path.dirname(X9_ROOT), "Codex_Workspace")
);

// Where session summaries live. Claude writes to its own folder and reads Codex's.
export const CLAUDE_SUMMARY_DIR = path.join(X9_ROOT, "04_Session_Notes");

// Codex's results folder. The template calls it 02_Outbox; some workspaces use 03_Outbox.
// Set X9_CODEX_OUTBOX to a folder name or full path to choose it. Looked up on each call,
// so a folder created later is picked up without a restart.
export function codexOutboxDir() {
  const named = process.env.X9_CODEX_OUTBOX;
  if (named) return path.resolve(CODEX_ROOT, named);
  for (const name of ["02_Outbox", "03_Outbox"]) {
    const p = path.join(CODEX_ROOT, name);
    try { if (fs.statSync(p).isDirectory()) return p; } catch {}
  }
  return path.join(CODEX_ROOT, "02_Outbox");
}
export function codexSummaryDir() {
  return path.join(codexOutboxDir(), "session_summaries");
}

// Today's date on this computer (not UTC), as YYYY-MM-DD.
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Turn a title into a safe file name part: letters, digits and dashes only.
export function slugify(text, maxLen = 60) {
  const s = String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLen).replace(/-+$/g, "");
  return s || "session";
}

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
