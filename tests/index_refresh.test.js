import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INCOMPLETE_MARKER, isFresh, startIndexRefresh } from "../the_forge/index_refresh.js";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-refresh-"));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// A stand-in "indexer": a Node script that appends a line to a file each time it runs.
const MARK = path.join(ROOT, "runs.txt");
const SCRIPT = path.join(ROOT, "fake_indexer.js");
fs.writeFileSync(SCRIPT, `require("fs").appendFileSync(${JSON.stringify(MARK)}, "run\\n");`);
const runs = () => (fs.existsSync(MARK) ? fs.readFileSync(MARK, "utf8").trim().split("\n").length : 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Starting a process can take well over half a second on a busy machine (or a CI runner),
// so wait for the expected state instead of sleeping a fixed time.
async function waitFor(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(25)) if (check()) return true;
  return check();
}

test("isFresh is false for a missing file and for an old one", () => {
  const db = path.join(ROOT, "a.db");
  assert.equal(isFresh(db, 1000), false);
  fs.writeFileSync(db, "x");
  assert.equal(isFresh(db, 60000), true);
  assert.equal(isFresh(db, 60000, Date.now() + 120000), false);
});

test("rebuilds shortly after start when there is no index, and not twice at once", async () => {
  const logs = [];
  const r = startIndexRefresh({ command: process.execPath, args: [SCRIPT], dbPath: path.join(ROOT, "missing.db"), intervalHours: 1, startupDelayMs: 20, log: (m) => logs.push(m) });
  try {
    // Wait for the run to finish, not just to start: the fake indexer writes its mark before
    // its process exits, and a refresh requested while one is running is (rightly) skipped.
    assert.ok(await waitFor(() => logs.some((m) => /rebuilt/.test(m))), `expected a finished run, saw ${runs()} started`);
    assert.equal(runs(), 1);
    const [x, y] = await Promise.all([r.refreshNow(), r.refreshNow()]);
    assert.equal([x, y].filter(Boolean).length, 1, "a second request while one is running is skipped");
  } finally { r.stop(); }
});

test("does not rebuild at startup when the index is already fresh", async () => {
  const before = runs();
  const db = path.join(ROOT, "fresh.db");
  fs.writeFileSync(db, "x");
  const r = startIndexRefresh({ command: process.execPath, args: [SCRIPT], dbPath: db, intervalHours: 1, startupDelayMs: 20 });
  try { await wait(400); assert.equal(runs(), before); } finally { r.stop(); }
});

test("can be turned off, and a failing indexer does not throw", async () => {
  const off = startIndexRefresh({ command: process.execPath, args: [SCRIPT], dbPath: "x", intervalHours: 0 });
  assert.equal(await off.refreshNow(), false);
  const logs = [];
  const bad = startIndexRefresh({ command: process.execPath, args: ["-e", "process.exit(3)"], dbPath: "x", intervalHours: 1, startupDelayMs: 100000, log: (m) => logs.push(m) });
  try {
    assert.equal(await bad.refreshNow(), false);
    assert.match(logs.join("\n"), /failed/);
  } finally { bad.stop(); }
});

test("an unfinished semantic build continues soon instead of hours later", async () => {
  // Reports "incomplete" on its first run only, like a first semantic build that runs out of time.
  const marks = path.join(ROOT, "continue.txt");
  const script = path.join(ROOT, "fake_semantic.js");
  fs.writeFileSync(script, `const fs = require("fs"); const p = ${JSON.stringify(marks)};
const n = fs.existsSync(p) ? fs.readFileSync(p, "utf8").length : 0; fs.appendFileSync(p, "x");
if (n === 0) console.log("[X9 Indexer] ${INCOMPLETE_MARKER}: 3 files left for the next run.");`);
  const logs = [];
  const r = startIndexRefresh({ command: process.execPath, args: [script], dbPath: path.join(ROOT, "none.db"), intervalHours: 1, startupDelayMs: 10, continueDelayMs: 50, log: (m) => logs.push(m) });
  try {
    assert.ok(await waitFor(() => fs.existsSync(marks) && fs.readFileSync(marks, "utf8").length === 2), "one follow-up run");
    await wait(300);
    assert.equal(fs.readFileSync(marks, "utf8").length, 2, "and then it stops");
    assert.match(logs.join("\n"), /continuing shortly/);
  } finally { r.stop(); }
});

test("a fresh index is still refreshed at startup when a semantic build was left unfinished", async () => {
  const before = runs();
  const db = path.join(ROOT, "fresh2.db");
  const pending = path.join(ROOT, "x9_vectors.db.incomplete");
  fs.writeFileSync(db, "x");
  fs.writeFileSync(pending, "3");
  const r = startIndexRefresh({ command: process.execPath, args: [SCRIPT], dbPath: db, pendingMarker: pending, intervalHours: 1, startupDelayMs: 20 });
  try { assert.ok(await waitFor(() => runs() === before + 1), `expected a run, saw ${runs() - before}`); } finally { r.stop(); }
});
