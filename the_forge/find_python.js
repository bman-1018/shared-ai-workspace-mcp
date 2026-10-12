// Finds a Python that can run the search scripts. Used by the search plugin and by the
// background index refresh. Programs are started without a shell, so only a real
// python.exe is found; the Windows "py" launcher is tried too. Set X9_PYTHON to force one.
// A virtual environment at x9_search_engine/.venv (where the optional semantic search
// packages are installed) is preferred over the system Python.
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ENGINE_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "x9_search_engine");
const VENV_PYTHON = process.platform === "win32"
  ? path.join(ENGINE_DIR, ".venv", "Scripts", "python.exe")
  : path.join(ENGINE_DIR, ".venv", "bin", "python");

let cached;

export function findPython() {
  if (cached) return cached;
  const candidates = process.env.X9_PYTHON
    ? [process.env.X9_PYTHON]
    : [...(fs.existsSync(VENV_PYTHON) ? [VENV_PYTHON] : []), "python", "py", "python3"];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ["-c", "import sqlite3"], { windowsHide: true, timeout: 10000 });
    if (!r.error && r.status === 0) { cached = cmd; return cmd; }
  }
  // Nothing worked. Not cached, so a Python installed later is found without a restart.
  return candidates[0];
}
