import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isFresh, startIndexRefresh } from "../the_forge/index_refresh.js";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-refresh-"));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// A stand-in "indexer": a Node script that appends a line to a file each time it runs.
const MARK = path.join(ROOT, "runs.txt");
const SCRIPT = path.join(ROOT, "fake_indexer.js");
fs.writeFileSync(SCRIPT, `require("fs").appendFileSync(${JSON.stringify(MARK)}, "run\\n");`);
const runs = () => (fs.existsSync(MARK) ? fs.readFileSync(MARK, "utf8").trim().split("\n").length : 0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("isFresh is false for a missing file and for an old one", () => {
  const db = path.join(ROOT, "a.db");
  assert.equal(isFresh(db, 1000), false);
  fs.writeFileSync(db, "x");
  assert.equal(isFresh(db, 60000), true);
  assert.equal(isFresh(db, 60000, Date.now() + 120000), false);
});

test("rebuilds shortly after start when there is no index, and not twice at once", async () => {
  const r = startIndexRefresh({ command: process.execPath, args: [SCRIPT], dbPath: path.join(ROOT, "missing.db"), intervalHours: 1, startupDelayMs: 20 });
  try {
    await wait(600);
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
