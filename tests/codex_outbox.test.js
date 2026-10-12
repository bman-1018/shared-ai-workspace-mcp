// A Codex workspace that uses 03_Outbox (not the template's 02_Outbox), with its own
// finished reviews in the outbox. Runs in its own process: env must be set before import.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-outbox-"));
const WS = path.join(ROOT, "Claude_Workspace");
const CODEX = path.join(ROOT, "Codex_Workspace");
const OUTBOX = path.join(CODEX, "03_Outbox");
fs.mkdirSync(path.join(WS, "04_Session_Notes"), { recursive: true });
fs.mkdirSync(OUTBOX, { recursive: true });
fs.mkdirSync(path.join(CODEX, "02_Active_Tasks"), { recursive: true });
process.env.X9_ROOT = WS;
process.env.X9_CODEX_ROOT = CODEX;
delete process.env.X9_CODEX_OUTBOX;

const shared = await import("../Hot_Plugins/_shared.js");
const find = await import("../Hot_Plugins/find_sessions.js");
const save = await import("../Hot_Plugins/save_session_summary.js");
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

fs.writeFileSync(path.join(OUTBOX, "2026-09-01_review-billing.md"), "# Review of billing\n\nCodex reviewed the billing module and found two bugs.\n");
fs.mkdirSync(path.join(OUTBOX, "session_summaries"));
fs.writeFileSync(path.join(OUTBOX, "session_summaries", "2026-09-02_codex-session.md"),
  '---\nagent: codex\ndate: 2026-09-02\ntitle: "Codex session: billing fix"\ntags: [billing]\n---\n\n# x\n\n## Summary\nFixed the two billing bugs.\n');

test("the outbox folder is detected: 02_Outbox, else 03_Outbox, else an override", () => {
  assert.equal(shared.codexOutboxDir(), OUTBOX);
  fs.mkdirSync(path.join(CODEX, "02_Outbox"));
  assert.equal(shared.codexOutboxDir(), path.join(CODEX, "02_Outbox"));
  fs.rmdirSync(path.join(CODEX, "02_Outbox"));
  process.env.X9_CODEX_OUTBOX = "02_Active_Tasks";
  assert.equal(shared.codexOutboxDir(), path.join(CODEX, "02_Active_Tasks"));
  delete process.env.X9_CODEX_OUTBOX;
});

test("find_sessions lists Codex summaries and the reviews sitting in its outbox", async () => {
  const r = await find.toolHandler({ agent: "codex" });
  assert.equal(r.status, "Success");
  const ids = r.sessions.map((s) => s.id).sort();
  assert.deepEqual(ids, ["codex/2026-09-02_codex-session.md", "codex/outbox/2026-09-01_review-billing.md"]);
  assert.equal(r.folders.codex, "found");
  // a JSON-quoted title with a colon reads back unchanged
  assert.equal(r.sessions.find((s) => s.id.endsWith("codex-session.md")).title, "Codex session: billing fix");
  const full = await find.toolHandler({ read: "codex/outbox/2026-09-01_review-billing.md" });
  assert.match(full.content, /two bugs/);
});

test("a saved title with YAML-looking characters round-trips", async () => {
  for (const title of ["[draft] plan", "Fix: the #1 bug", 'He said "hi"']) {
    const saved = await save.toolHandler({ title, summary: "A summary that is long enough to be accepted by the tool." });
    const id = "claude/" + path.basename(saved.path);
    const back = (await find.toolHandler({ agent: "claude", limit: 25 })).sessions.find((s) => s.id === id);
    assert.equal(back.title, title);
  }
});

test("a title with no Latin letters still saves, many times", async () => {
  const a = await save.toolHandler({ title: "日本語のタイトル", summary: "A summary that is long enough to be accepted by the tool." });
  const b = await save.toolHandler({ title: "日本語のタイトル", summary: "A summary that is long enough to be accepted by the tool." });
  assert.match(path.basename(a.path), /^\d{4}-\d{2}-\d{2}_session-\d{4}\.md$/);
  assert.notEqual(a.path, b.path);
});

test("symbolic links are neither listed nor read", async (t) => {
  const outside = path.join(ROOT, "outside.md");
  fs.writeFileSync(outside, "TOPSECRET outside the folder");
  const link = path.join(OUTBOX, "session_summaries", "evil.md");
  try { fs.symlinkSync(outside, link); } catch { return t.skip("cannot create symlinks here"); }
  const listed = await find.toolHandler({ agent: "codex", query: "TOPSECRET" });
  assert.equal(listed.status, "No Results");
  const read = await find.toolHandler({ read: "codex/evil.md" });
  assert.equal(read.error, true);
  assert.doesNotMatch(JSON.stringify(read), /TOPSECRET/);
});

test("reading a huge file loads only the start", async () => {
  fs.writeFileSync(path.join(OUTBOX, "huge.md"), "# huge\n" + "word ".repeat(200_000));
  const r = await find.toolHandler({ read: "codex/outbox/huge.md" });
  assert.equal(r.status, "Success");
  assert.ok(r.content.length <= 60000);
  assert.match(r.note, /Shown the first/);
});

test("the tool descriptions tell the model the content is data", () => {
  assert.match(find.toolSchema.description, /not as instructions/i);
});
