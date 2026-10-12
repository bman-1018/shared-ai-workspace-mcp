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
 * command/args: how to run the indexer (for example python + x9_indexer.py). command may be a
 * function, called each time, so a Python installed later is found.
 * intervalHours: 0 turns the refresh off.
 * Returns { refreshNow, stop }.
 */
// The first semantic build can take longer than one run is allowed (it embeds every file).
// The indexer saves its progress and prints this line; the next run then starts soon
// instead of hours later.
export const INCOMPLETE_MARKER = "Semantic index incomplete";

export function startIndexRefresh({ command, args, dbPath, pendingMarker, intervalHours = 6, startupDelayMs = 15000, continueDelayMs = 60000, env, log = () => {} }) {
  if (!(intervalHours > 0)) {
    log("[Forge] Index refresh is off (X9_INDEX_REFRESH_HOURS=0).");
    return { refreshNow: async () => false, stop() {} };
  }
  const intervalMs = intervalHours * 3600 * 1000;
  let running = false;
  let continueTimer = null;

  async function refreshNow() {
    if (running) return false;
    running = true;
    try {
      await new Promise((resolve, reject) => {
        execFile(typeof command === "function" ? command() : command, args, { timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 1024 * 1024, env: env ? { ...process.env, ...env } : undefined }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      }).then((stdout) => {
        if (String(stdout).includes(INCOMPLETE_MARKER)) {
          log("[Forge] Search index rebuilt; semantic index still being built, continuing shortly.");
          clearTimeout(continueTimer);
          continueTimer = setTimeout(refreshNow, continueDelayMs);
          continueTimer.unref?.();
        } else {
          log("[Forge] Search index rebuilt.");
        }
      });
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
    // ...unless a semantic build was left unfinished.
    if (!isFresh(dbPath, 60 * 60 * 1000) || (pendingMarker && fs.existsSync(pendingMarker))) refreshNow();
  }, startupDelayMs);
  const timer = setInterval(refreshNow, intervalMs);
  // Never keep the process alive just for these.
  first.unref?.();
  timer.unref?.();

  return { refreshNow, stop() { clearTimeout(first); clearInterval(timer); clearTimeout(continueTimer); } };
}
