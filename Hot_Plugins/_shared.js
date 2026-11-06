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

// ------------------------------------------------------------
// Writing without following links
// resolveInside only checks the path as text. A symlink or junction already in the
// workspace (a folder, or the file itself) could still send a write somewhere else.
// These helpers refuse links below rootDir. rootDir itself may be a link, because the
// user chose it.
// O_NOFOLLOW is 0 on Windows, so there the lstat check before opening is the guard.
// O_NONBLOCK keeps a named pipe from hanging the open; it is then refused as not a file.
// ------------------------------------------------------------
const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_APPEND } = fs.constants;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const O_NONBLOCK = fs.constants.O_NONBLOCK || 0;

function relativeInside(rootDir, target) {
  const root = path.resolve(rootDir);
  const rel = path.relative(root, path.resolve(target));
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the allowed folder: ${target}`);
  }
  return { root, rel };
}

function linkError(p) {
  return new Error(`Refusing to follow a link (symlink or junction): ${p}`);
}

/**
 * Make sure dir exists and that no folder between rootDir and dir is a link.
 * Folders are created one at a time, so mkdir never follows a link out of the workspace.
 */
export async function ensureRealDir(rootDir, dir) {
  const { root, rel } = relativeInside(rootDir, dir);
  await fs.promises.mkdir(root, { recursive: true });
  let current = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let st;
    try {
      st = await fs.promises.lstat(current);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      try { await fs.promises.mkdir(current); } catch (e) { if (e.code !== "EEXIST") throw e; }
      st = await fs.promises.lstat(current);
    }
    if (st.isSymbolicLink()) throw linkError(current);
    if (!st.isDirectory()) throw new Error(`Not a folder: ${current}`);
  }
  return current;
}

async function refuseLeafLink(target) {
  try {
    if ((await fs.promises.lstat(target)).isSymbolicLink()) throw linkError(target);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function openNoFollow(target, flags, mode) {
  await refuseLeafLink(target);
  try {
    return await fs.promises.open(target, flags | O_NOFOLLOW | O_NONBLOCK, mode);
  } catch (err) {
    // ELOOP on Linux, EMLINK on FreeBSD: the last part of the path is a link.
    if (err.code === "ELOOP" || err.code === "EMLINK") throw linkError(target);
    throw err;
  }
}

/**
 * Write data to target, which must be inside rootDir, without following links.
 * exclusive: fail with EEXIST if the file is already there (never overwrite).
 * append: add to the end instead of replacing the contents.
 * An existing file with other hard links is refused, since writing to it would
 * change a file somewhere else too. Returns the file's size after the write.
 */
export async function writeFileInside(rootDir, target, data, { exclusive = false, append = false } = {}) {
  relativeInside(rootDir, target);
  await ensureRealDir(rootDir, path.dirname(target));
  const flags = O_WRONLY | O_CREAT | (exclusive ? O_EXCL : 0) | (append ? O_APPEND : 0);
  const fh = await openNoFollow(target, flags, 0o644);
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new Error(`Not a regular file: ${target}`);
    if (st.nlink > 1) throw new Error(`Refusing to write to a file with more than one hard link: ${target}`);
    // Truncate only after the checks, so a refused file is left as it was.
    if (!append && !exclusive) await fh.truncate(0);
    await fh.writeFile(data);
    return (await fh.stat()).size;
  } finally {
    await fh.close();
  }
}

/** Read target, which must be inside rootDir, without following links. */
export async function readFileInside(rootDir, target) {
  relativeInside(rootDir, target);
  const fh = await openNoFollow(target, O_RDONLY);
  try {
    if (!(await fh.stat()).isFile()) throw new Error(`Not a regular file: ${target}`);
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}
