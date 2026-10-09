import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function findPython() {
  for (const cmd of [process.env.X9_PYTHON, "python", "python3", "py"].filter(Boolean)) {
    try {
      execFileSync(cmd, ["-c", "import sqlite3;c=sqlite3.connect(':memory:');c.execute(\"create virtual table t using fts5(a, tokenize='trigram')\")"], { stdio: "ignore" });
      return cmd;
    } catch {}
  }
  return null;
}
const PY = findPython();

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-search-"));
const WS = path.join(ROOT, "Claude_Workspace");
fs.mkdirSync(path.join(WS, "notes"), { recursive: true });
fs.writeFileSync(path.join(WS, "notes", "plan.md"), "The rollout plan mentions a unique needlephrase here.");
fs.writeFileSync(path.join(WS, "notes", "secrets.txt"), "hiddenvaluexyz should never be indexed");
fs.writeFileSync(path.join(WS, "notes", "credentials.json"), '{"k":"hiddencredvalue"}');
const DB = path.join(ROOT, "index.db");
const PWNED = path.join(ROOT, "pwned.txt");

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test("search finds indexed text and skips secret-named files", { skip: PY ? false : "no Python with SQLite FTS5 trigram support" }, async () => {
  execFileSync(PY, [path.join(REPO, "x9_search_engine", "x9_indexer.py")], { env: { ...process.env, X9_ROOT: WS, X9_DB_PATH: DB }, stdio: "ignore" });
  process.env.X9_DB_PATH = DB;
  process.env.X9_PYTHON = PY;
  const { toolHandler } = await import("../Hot_Plugins/x9_python_bridge.js");

  const hit = await toolHandler({ query: "needlephrase" });
  assert.equal(hit.status, "Success");
  assert.match(JSON.stringify(hit.matches), /plan\.md/);

  assert.equal((await toolHandler({ query: "hiddenvaluexyz" })).status, "No Results");
  assert.equal((await toolHandler({ query: "hiddencredvalue" })).status, "No Results");

  // Shell metacharacters in the query must not run anything.
  const evil = `x" & echo INJECTED > "${PWNED}" & "`;
  await toolHandler({ query: evil });
  await toolHandler({ query: `x"; touch "${PWNED}"; "` });
  await toolHandler({ query: "$(touch " + PWNED + ")" });
  assert.ok(!fs.existsSync(PWNED), "query text must never be executed");

  // Input limits
  assert.equal((await toolHandler({ query: "" })).error, true);
  assert.equal((await toolHandler({ query: "a".repeat(501) })).error, true);
  assert.equal((await toolHandler({ query: 42 })).error, true);
});
