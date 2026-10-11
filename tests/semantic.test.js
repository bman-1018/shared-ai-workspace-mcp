import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Semantic search. These tests use X9_EMBEDDER=hash, a stand-in that turns words into
// vectors without a model, so the whole pipeline (chunking, storage, reuse, ranking, the
// hybrid merge, fallbacks) is tested without downloading anything. It needs numpy only.
// The last test uses the real model when it is installed and downloaded.

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENGINE = path.join(REPO, "x9_search_engine");
const VENV = process.platform === "win32" ? path.join(ENGINE, ".venv", "Scripts", "python.exe") : path.join(ENGINE, ".venv", "bin", "python");

function findPython(probe) {
  for (const cmd of [process.env.X9_PYTHON, fs.existsSync(VENV) ? VENV : null, "python", "python3", "py"].filter(Boolean)) {
    try { execFileSync(cmd, ["-c", probe], { stdio: "ignore" }); return cmd; } catch {}
  }
  return null;
}
const PY = findPython("import numpy, sqlite3; sqlite3.connect(':memory:').execute(\"create virtual table t using fts5(a, tokenize='trigram')\")");
const REAL_PY = findPython(
  "import numpy, onnxruntime, tokenizers, os, sys; sys.path.insert(0, " + JSON.stringify(ENGINE) + "); import x9_embed; " +
  "assert (x9_embed.MODEL_DIR / 'onnx' / 'model.onnx').exists()");
const skip = PY ? false : "no Python with numpy and SQLite FTS5";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-semantic-"));
const WS = path.join(ROOT, "Claude_Workspace");
const write = (rel, text) => { const p = path.join(WS, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
write("notes/both.md", "The zebra herd started its migration north in spring.");
write("notes/one-word.md", "Database migration steps for the billing service.");
write("notes/unrelated.md", "Grocery list with eggs and spinach.");
write("notes/secrets.md", "zebra migration hiddenvaluexyz");
write("07_Chat_History/2026-01-01_Forge_Action_Log.jsonl", '{"output":"zebra migration from the log"}');
write("notes/long.md", Array.from({ length: 60 }, (_, i) => `Paragraph ${i} talks about topic number ${i} in some detail.`).join("\n\n"));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const DB = path.join(ROOT, "index.db");
const VEC = path.join(ROOT, "x9_vectors.db");
// The stand-in scores one shared word in seven at about 0.27, so its threshold is lower than the real model's.
const baseEnv = { ...process.env, X9_ROOT: WS, X9_DB_PATH: DB, X9_INDEX_CODEX: "0", X9_EMBEDDER: "hash", X9_SEMANTIC_MIN_SCORE: "0.1" };
delete baseEnv.X9_SEMANTIC;
delete baseEnv.X9_VECTOR_DB_PATH;
const index = (env = {}) => execFileSync(PY, [path.join(ENGINE, "x9_indexer.py")], { env: { ...baseEnv, ...env } }).toString();
const query = (q, mode, env = {}, limit = 10) =>
  JSON.parse(execFileSync(PY, [path.join(ENGINE, "x9_query.py"), q, String(limit), mode], { env: { ...baseEnv, ...env } }).toString());
const sql = (statement) =>
  JSON.parse(execFileSync(PY, ["-c", `import sqlite3, json; print(json.dumps(sqlite3.connect(${JSON.stringify(VEC)}).execute(${JSON.stringify(statement)}).fetchall()))`]).toString());

test("chunks are bounded, overlap, and cover the whole text", { skip }, () => {
  const out = execFileSync(PY, ["-c",
    "import sys, json; sys.path.insert(0, sys.argv[1]); from x9_embed import chunk_text; " +
    "t = ' '.join(f'word{i}' for i in range(2000)); c = chunk_text(t); " +
    "print(json.dumps([len(c), max(len(x) for x in c), c[0][-20:] in c[1], c[-1].endswith('word1999'), chunk_text('  '), chunk_text('short')]))",
    ENGINE]).toString();
  const [count, longest, overlaps, coversEnd, empty, short] = JSON.parse(out);
  assert.ok(count > 10);
  assert.ok(longest <= 1000);
  assert.equal(overlaps, true);
  assert.equal(coversEnd, true);
  assert.deepEqual(empty, []);
  assert.deepEqual(short, ["short"]);
});

test("the indexer builds the semantic store and leaves out secret files and the action log", { skip }, () => {
  assert.match(index(), /Semantic index: \d+ chunks embedded, 0 reused/);
  const paths = sql("select distinct path from chunks").map((r) => r[0]);
  assert.ok(paths.some((p) => p.endsWith("both.md")));
  assert.ok(!paths.some((p) => p.includes("secrets")), "secret-named files are never embedded");
  assert.ok(!paths.some((p) => p.includes("Forge_Action_Log")), "the action log is never embedded");
  assert.ok(sql("select count(*) from chunks where path like '%long.md'")[0][0] > 1, "long files are split into chunks");
});

test("the downloaded model is never indexed, but a workspace folder named models is", { skip }, () => {
  const ws = path.join(ROOT, "with-model");
  const modelDir = path.join(ws, "_mcp_tools", "x9_search_engine", "models", "bge-small-en-v1.5");
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, "tokenizer.json"), '{"vocab": "tokenizervocabjunk"}');
  fs.mkdirSync(path.join(ws, "notes", "models"), { recursive: true });
  fs.writeFileSync(path.join(ws, "notes", "models", "pricing-model.md"), "Our pricing model has three tiers.");
  const db = path.join(ROOT, "with-model.db");
  execFileSync(PY, [path.join(ENGINE, "x9_indexer.py")], { env: { ...baseEnv, X9_ROOT: ws, X9_DB_PATH: db, X9_MODEL_DIR: path.join(ws, "_mcp_tools", "x9_search_engine", "models") } });
  const kw = (q) => JSON.parse(execFileSync(PY, [path.join(ENGINE, "x9_query.py"), q, "5", "keyword"], { env: { ...baseEnv, X9_DB_PATH: db } }).toString()).results;
  assert.equal(kw("tokenizervocabjunk").length, 0);
  assert.equal(kw("three tiers").length, 1);
});

test("hybrid search finds files that keyword search misses, and ranks files found both ways first", { skip }, () => {
  index();
  const keyword = query("zebra migration", "keyword").results.map((r) => path.basename(r.path));
  assert.deepEqual(keyword, ["both.md"], "keyword search needs every word");

  const hybrid = query("zebra migration", "hybrid");
  assert.equal(hybrid.mode, "hybrid");
  assert.equal(path.basename(hybrid.results[0].path), "both.md");
  assert.deepEqual(hybrid.results[0].found_by, ["keyword", "semantic"]);
  assert.match(hybrid.results[0].context, />>/, "the keyword snippet with marked words is kept");
  const oneWord = hybrid.results.find((r) => r.path.endsWith("one-word.md"));
  assert.deepEqual(oneWord.found_by, ["semantic"]);
  assert.ok(!hybrid.results.some((r) => r.path.endsWith("unrelated.md")), "unrelated files are cut by the score threshold");

  const semantic = query("zebra migration", "semantic");
  assert.ok(semantic.results.every((r) => typeof r.score === "number"));
  assert.equal(query("photosynthesis", "semantic").results.length, 0);
});

test("unchanged files reuse their vectors; only changed files are embedded again", { skip }, () => {
  index();
  assert.match(index(), /Semantic index: 0 chunks embedded, \d+ reused/);
  write("notes/one-word.md", "Database migration steps for the billing service, now with a rollback plan.");
  assert.match(index(), /Semantic index: 1 chunks embedded, \d+ reused/);
  // A different chunk size or model would make old vectors useless: they are then all rebuilt.
  execFileSync(PY, ["-c", `import sqlite3; c = sqlite3.connect(${JSON.stringify(VEC)}); c.execute("update meta set value = 'old' where key = 'signature'"); c.commit()`]);
  assert.match(index(), /Semantic index: \d+ chunks embedded, 0 reused/);
});

test("a time budget saves progress and the next run finishes the job", { skip }, () => {
  fs.rmSync(VEC, { force: true });
  const first = index({ X9_SEMANTIC_BUDGET_SECONDS: "0.000001" });
  assert.match(first, /Semantic index incomplete: \d+ files left/);
  assert.ok(fs.existsSync(VEC + ".incomplete"), "the marker tells the Forge to continue after a restart");
  assert.ok(sql("select count(distinct path) from chunks")[0][0] >= 1, "every run makes progress");
  assert.match(query("zebra migration", "hybrid").semantic_partial, /still running \(\d+ files not embedded yet\)/);
  const second = index();
  assert.doesNotMatch(second, /incomplete/);
  assert.equal(query("zebra migration", "hybrid").semantic_partial, null);
  assert.ok(!fs.existsSync(VEC + ".incomplete"));
});

test("hybrid falls back to keyword search and says why", { skip }, () => {
  index();
  const off = query("zebra migration", "hybrid", { X9_SEMANTIC: "0" });
  assert.equal(off.mode, "keyword");
  assert.match(off.semantic, /turned off/);
  assert.equal(off.results.length, 1);

  const missing = query("zebra migration", "hybrid", { X9_VECTOR_DB_PATH: path.join(ROOT, "nope.db") });
  assert.equal(missing.mode, "keyword");
  assert.match(missing.semantic, /not built yet/);

  assert.match(JSON.stringify(query("x", "fancy")), /mode must be one of/);
});

test("x9_search tool: mode option, which search found each result, clear fallback", { skip }, async () => {
  index();
  const saved = { ...process.env };
  Object.assign(process.env, { X9_DB_PATH: DB, X9_PYTHON: PY, X9_EMBEDDER: "hash", X9_SEMANTIC_MIN_SCORE: "0.1" });
  delete process.env.X9_SEMANTIC;
  try {
    const { toolHandler, toolSchema } = await import(`../Hot_Plugins/x9_python_bridge.js?semantic=${Date.now()}`);
    assert.deepEqual(toolSchema.inputSchema.properties.mode.enum, ["hybrid", "keyword", "semantic"]);
    const r = await toolHandler({ query: "zebra migration" });
    assert.equal(r.status, "Success");
    assert.equal(r.mode, "hybrid");
    assert.ok(r.matches.some((m) => m.found_by.includes("semantic")));
    assert.equal((await toolHandler({ query: "zebra", mode: "nonsense" })).error, true);
    process.env.X9_SEMANTIC = "0";
    const off = await toolHandler({ query: "zebra migration" });
    assert.equal(off.mode, "keyword");
    assert.match(off.semantic_search, /Unavailable: turned off/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("real model: finds text by meaning with no words in common", { skip: REAL_PY ? false : "semantic packages or model not installed" }, () => {
  const ws = path.join(ROOT, "real");
  const put = (name, text) => { fs.mkdirSync(ws, { recursive: true }); fs.writeFileSync(path.join(ws, name), text); };
  put("tiers.md", "Pricing tiers\n\nWe agreed the starter plan costs 29 dollars a month and the team plan 99.");
  put("runbook.md", "Deployment runbook\n\nBefore shipping to production, run the migrations on staging, then promote the build.");
  put("hiring.md", "Hiring notes\n\nWe interviewed three candidates for the frontend role.");
  const env = { ...process.env, X9_ROOT: ws, X9_DB_PATH: path.join(ROOT, "real.db"), X9_INDEX_CODEX: "0" };
  delete env.X9_EMBEDDER; delete env.X9_SEMANTIC; delete env.X9_VECTOR_DB_PATH;
  // This checks ranking. Three short notes score lower than a real workspace, so no threshold here.
  env.X9_SEMANTIC_MIN_SCORE = "0";
  execFileSync(REAL_PY, [path.join(ENGINE, "x9_indexer.py")], { env });
  const top = (q) => path.basename(JSON.parse(execFileSync(REAL_PY, [path.join(ENGINE, "x9_query.py"), q, "3", "semantic"], { env }).toString()).results[0].path);
  assert.equal(top("how much do we charge customers"), "tiers.md");
  assert.equal(top("steps to release a new version"), "runbook.md");
  assert.equal(top("who should we hire for the UI job"), "hiring.md");
});
