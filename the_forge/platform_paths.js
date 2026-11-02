// Default locations that differ by operating system. Used by the Forge, its plugins,
// the Observer and the setup script, so every part agrees on the same defaults.
// Only Node built-ins here: the Observer and the setup script import this file too.
import os from "os";
import path from "path";

// The workspace folder when X9_ROOT is not set.
// Windows: X:\Claude_Workspace (an external SSD given the letter X:).
// macOS and Linux: ~/AI_Workspace/Claude_Workspace. Point X9_ROOT at an external
// drive instead (for example /Volumes/X9/Claude_Workspace on a Mac) if you use one.
export function defaultWorkspaceRoot({ platform = process.platform, home = os.homedir() } = {}) {
  return platform === "win32"
    ? "X:\\Claude_Workspace"
    : path.posix.join(home, "AI_Workspace", "Claude_Workspace");
}

// The workspace folder the servers use: X9_ROOT if set, else the default above.
export function workspaceRoot(env = process.env) {
  return path.resolve(env.X9_ROOT || defaultWorkspaceRoot());
}

// Where Claude Desktop keeps its data (config file, Cowork session logs).
// X9_CLAUDE_DATA_DIR overrides it. Returns null when it cannot be worked out
// (Windows without APPDATA).
export function claudeDataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.X9_CLAUDE_DATA_DIR) return env.X9_CLAUDE_DATA_DIR;
  if (platform === "win32") return env.APPDATA ? path.win32.join(env.APPDATA, "Claude") : null;
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Claude");
  // Linux: there is no official Claude Desktop build; community builds use this folder.
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, ".config"), "Claude");
}
