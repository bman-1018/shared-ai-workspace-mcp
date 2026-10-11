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
// These tests cover keyword search; semantic search has its own file (semantic.test.js).
process.env.X9_SEMANTIC = "0";

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

// ---- Search quality: the problems that made search unusable over time ----
const WS2_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-search2-"));
const WS2 = path.join(WS2_ROOT, "Claude_Workspace");
const CODEX2 = path.join(WS2_ROOT, "Codex_Workspace");
const DB2 = path.join(WS2_ROOT, "index2.db");
const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
write(path.join(WS2, "01_Active_Projects", "rollout-checklist.md"), "Steps for the launch.");
write(path.join(WS2, "04_Session_Notes", "design.md"), "The deploy checklist covers staging and the migration order.");
write(path.join(WS2, "07_Chat_History", "2026-01-01_Forge_Action_Log.jsonl"), '{"output":"deploy checklist staging migration"}');
write(path.join(WS2, "07_Chat_History", "2026-01-01_Forge_Action_Log.json"), '{"output":"deploy checklist staging migration"}');
write(path.join(WS2, "07_Chat_History", "Cowork", "session1", "raw.json"), '{"text":"rawcoworkduplicate"}');
write(path.join(WS2, "07_Chat_History", "Readable_Logs", "Cowork", "2026-03-01_chat.md"), "We talked about the readablecoworkexport.");
write(path.join(WS2, "notes", "tiny.md"), "go to AB room");
write(path.join(CODEX2, "02_Outbox", "from-codex.md"), "Codex wrote about the zebrafinding module.");
test.after(() => fs.rmSync(WS2_ROOT, { recursive: true, force: true }));

test("search: words in any order, file names, phrases, short terms, limits, Codex files, no logs", { skip: PY ? false : "no Python with SQLite FTS5 trigram support" }, () => {
  const env = { ...process.env, X9_ROOT: WS2, X9_DB_PATH: DB2 };
  execFileSync(PY, [path.join(REPO, "x9_search_engine", "x9_indexer.py")], { env, stdio: "ignore" });
  const q = (query, limit) => JSON.parse(execFileSync(PY, [path.join(REPO, "x9_search_engine", "x9_query.py"), query, String(limit || 10), "keyword"], { env }).toString()).results;

  // every word must match, any order
  const a = q("migration deploy");
  assert.ok(a.some((r) => r.path.endsWith("design.md")));
  // the action log is never indexed
  assert.ok(!a.some((r) => r.path.includes("07_Chat_History")));
  // the file name is searched, not just the text
  assert.ok(q("rollout checklist").some((r) => r.path.endsWith("rollout-checklist.md")));
  // readable chat exports stay searchable; raw copies and action logs do not
  assert.ok(q("readablecoworkexport").some((r) => r.path.includes("Readable_Logs")));
  assert.equal(q("rawcoworkduplicate").length, 0);
  // a quoted phrase stays together
  assert.ok(q('"deploy checklist"').some((r) => r.path.endsWith("design.md")));
  assert.equal(q('"checklist deploy"').length, 0);
  // terms shorter than three letters still work
  assert.ok(q("AB room").some((r) => r.path.endsWith("tiny.md")));
  // the Codex workspace next to the Claude one is indexed
  assert.ok(q("zebrafinding").some((r) => r.path.includes("Codex_Workspace")));
  // results carry a date and a marked snippet
  const hit = q("migration")[0];
  assert.match(hit.modified, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(hit.context, />>migration<</i);
  // limit is respected and capped
  assert.equal(q("the", 1).length, 1);
  // FTS syntax characters in a query are plain text
  assert.doesNotThrow(() => q('AND OR NOT * ( ) " -x :y'));
});

test("search tool reports the index age and can skip the Codex workspace", { skip: PY ? false : "no Python with SQLite FTS5 trigram support" }, () => {
  const env = { ...process.env, X9_ROOT: WS2, X9_DB_PATH: path.join(WS2_ROOT, "index3.db"), X9_INDEX_CODEX: "0" };
  execFileSync(PY, [path.join(REPO, "x9_search_engine", "x9_indexer.py")], { env, stdio: "ignore" });
  const out = JSON.parse(execFileSync(PY, [path.join(REPO, "x9_search_engine", "x9_query.py"), "zebrafinding", "10", "keyword"], { env }).toString());
  assert.equal(out.results.length, 0);
});

test("x9_search tool: limit, index age, stale warning", { skip: PY ? false : "no Python with SQLite FTS5 trigram support" }, async () => {
  const dbPath = path.join(WS2_ROOT, "index4.db");
  execFileSync(PY, [path.join(REPO, "x9_search_engine", "x9_indexer.py")], { env: { ...process.env, X9_ROOT: WS2, X9_DB_PATH: dbPath }, stdio: "ignore" });
  process.env.X9_DB_PATH = dbPath;
  process.env.X9_PYTHON = PY;
  const { toolHandler, toolSchema } = await import("../Hot_Plugins/x9_python_bridge.js");
  assert.equal(toolSchema.annotations.readOnlyHint, true);
  const fresh = await toolHandler({ query: "migration", limit: 1 });
  assert.equal(fresh.status, "Success");
  assert.equal(fresh.matches.length, 1);
  assert.ok(fresh.index_built);
  assert.equal(fresh.warning, undefined);
  const old = new Date(Date.now() - 5 * 24 * 3600 * 1000);
  fs.utimesSync(dbPath, old, old);
  assert.match((await toolHandler({ query: "migration" })).warning, /5 days old/);
});
