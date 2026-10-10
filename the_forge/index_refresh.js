// Keeps the search index fresh. The index was only ever built by hand, so after a few
// weeks search returned old results and people stopped trusting it. This rebuilds it in
// the background: shortly after the Forge starts (unless it is already fresh) and then on
// a timer. The rebuild writes a temporary file and swaps it in, so a search that runs
// at the same moment still sees a complete index.

import fs from "fs";
import { execFile } from "child_process";

export function isFresh(dbPath, maxAgeMs, now = Date.now()) {
  try {
    return now - fs.statSync(dbPath).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * command/args: how to run the indexer (for example python + x9_indexer.py).
 * intervalHours: 0 turns the refresh off.
 * Returns { refreshNow, stop }.
 */
export function startIndexRefresh({ command, args, dbPath, intervalHours = 6, startupDelayMs = 15000, log = () => {} }) {
  if (!(intervalHours > 0)) {
    log("[Forge] Index refresh is off (X9_INDEX_REFRESH_HOURS=0).");
    return { refreshNow: async () => false, stop() {} };
  }
  const intervalMs = intervalHours * 3600 * 1000;
  let running = false;

  async function refreshNow() {
    if (running) return false;
    running = true;
    try {
      await new Promise((resolve, reject) => {
        execFile(command, args, { timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      log("[Forge] Search index rebuilt.");
      return true;
    } catch (err) {
      log(`[Forge] Search index rebuild failed: ${err.message}`);
      return false;
    } finally {
      running = false;
    }
  }

  const first = setTimeout(() => {
    // Claude Desktop can start the server several times a day; do not rebuild each time.
    if (!isFresh(dbPath, 60 * 60 * 1000)) refreshNow();
  }, startupDelayMs);
  const timer = setInterval(refreshNow, intervalMs);
  // Never keep the process alive just for these.
  first.unref?.();
  timer.unref?.();

  return { refreshNow, stop() { clearTimeout(first); clearInterval(timer); } };
}
