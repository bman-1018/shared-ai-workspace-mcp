// Runs in its own process: X9_ROOT and X9_CODEX_ROOT must be set before the plugins are imported.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-sessions-"));
const WS = path.join(ROOT, "Claude_Workspace");
const CODEX = path.join(ROOT, "Codex_Workspace");
const CODEX_DIR = path.join(CODEX, "02_Outbox", "session_summaries");
fs.mkdirSync(WS, { recursive: true });
fs.mkdirSync(CODEX_DIR, { recursive: true });
process.env.X9_ROOT = WS;
process.env.X9_CODEX_ROOT = CODEX;

const save = await import("../Hot_Plugins/save_session_summary.js");
const find = await import("../Hot_Plugins/find_sessions.js");
const NOTES = path.join(WS, "04_Session_Notes");

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const base = { title: "Fixed the search index", summary: "We found that the search index was stale and rebuilt it. The reason was that nothing refreshed it." };

test("saving writes a summary file with front matter and sections", async () => {
  const r = await save.toolHandler({
    ...base,
    decisions: ["Rebuild in the background because manual rebuilds were forgotten"],
    files: ["x9_search_engine/x9_indexer.py"],
    open_items: ["Check Windows"],
    next_steps: ["Merge the pull request"],
    tags: ["Search Index", "search-index", "forge"],
    project: "X9",
  });
  assert.equal(r.status, "Success");
  assert.equal(path.dirname(r.path), NOTES);
  assert.match(path.basename(r.path), /^\d{4}-\d{2}-\d{2}_fixed-the-search-index\.md$/);
  const text = fs.readFileSync(r.path, "utf8");
  assert.match(text, /^---\ntype: session_summary\nagent: claude\n/);
  assert.match(text, /tags: \[search-index, forge\]/);
  assert.match(text, /project: "X9"/);
  for (const h of ["## Summary", "## Decisions", "## Files and links", "## Open items", "## Next steps"]) assert.ok(text.includes(h), h);
});

test("saving never overwrites an earlier summary", async () => {
  const a = await save.toolHandler(base);
  const b = await save.toolHandler(base);
  assert.notEqual(a.path, b.path);
  assert.match(path.basename(b.path), /-\d+\.md$/);
  assert.ok(fs.existsSync(a.path) && fs.existsSync(b.path));
});

test("secrets are replaced before anything is written", async () => {
  const secret = "sk-live-" + "a1b2c3d4e5f6g7h8i9j0k1l2";
  const r = await save.toolHandler({ title: "Key handling " + secret, summary: `We rotated the key ${secret} and checked Bearer abcdefghijklmnopqrstuvwxyz0123.`, decisions: [secret] });
  const text = fs.readFileSync(r.path, "utf8");
  assert.doesNotMatch(text, /a1b2c3d4e5f6g7h8i9j0k1l2/);
  assert.doesNotMatch(path.basename(r.path), /a1b2c3/);
  assert.match(text, /\[REDACTED\]/);
  assert.match(r.note, /secret/);
});

test("titles cannot reach outside the notes folder, and line breaks cannot forge front matter", async () => {
  const r = await save.toolHandler({ title: "../../evil\n---\nagent: codex", summary: "A summary that is long enough to be accepted here.", project: "p\nagent: codex" });
  assert.equal(path.dirname(r.path), NOTES);
  const head = fs.readFileSync(r.path, "utf8").split("\n---\n")[0];
  assert.equal((head.match(/^agent:/gm) || []).length, 1);
  assert.ok(!fs.existsSync(path.join(ROOT, "evil.md")));
});

test("bad input is refused", async () => {
  await assert.rejects(save.toolHandler({}));
  await assert.rejects(save.toolHandler({ title: "x", summary: "short" }));
  await assert.rejects(save.toolHandler({ title: "x", summary: "y".repeat(30001) }));
  await assert.rejects(save.toolHandler({ ...base, tags: "not an array" }));
});

test("tool annotations: saving is not read only, finding is", () => {
  assert.equal(save.toolSchema.annotations.readOnlyHint, false);
  assert.equal(save.toolSchema.annotations.destructiveHint, false);
  assert.equal(find.toolSchema.annotations.readOnlyHint, true);
});

// ---- find_sessions ----
fs.writeFileSync(path.join(CODEX_DIR, "2026-09-30_codex-refactor.md"),
  "---\ntype: session_summary\nagent: codex\ndate: 2026-09-30\ntitle: Codex refactored the billing module\ntags: [billing, refactor]\n---\n\n# Codex refactored the billing module\n\n## Summary\nCodex split the billing module into three files and added tests.\n");
fs.writeFileSync(path.join(CODEX_DIR, "no-front-matter.md"), "# Plain notes\n\nSomething about zebrafinding without any header block.\n");
fs.writeFileSync(path.join(CODEX_DIR, "_template.md"), "# template should be skipped\nzebrafinding");

test("find_sessions with no query lists both agents, newest first, and skips templates", async () => {
  const r = await find.toolHandler({});
  assert.equal(r.status, "Success");
  const ids = r.sessions.map((s) => s.id);
  assert.ok(ids.some((i) => i.startsWith("claude/")));
  assert.ok(ids.includes("codex/2026-09-30_codex-refactor.md"));
  assert.ok(!ids.some((i) => i.includes("_template")));
  const dates = r.sessions.map((s) => s.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(r.folders.codex, "found");
});

test("find_sessions searches words in any order and filters by agent and date", async () => {
  const hit = await find.toolHandler({ query: "module billing" });
  assert.equal(hit.sessions.length, 1);
  assert.equal(hit.sessions[0].agent, "codex");
  assert.deepEqual(hit.sessions[0].tags, ["billing", "refactor"]);
  assert.match(hit.sessions[0].excerpt, /split the billing module/);

  assert.equal((await find.toolHandler({ query: "billing", agent: "claude" })).status, "No Results");
  assert.equal((await find.toolHandler({ query: "search index", agent: "claude" })).status, "Success");
  assert.equal((await find.toolHandler({ query: "billing", since: "2026-10-01" })).status, "No Results");
  assert.equal((await find.toolHandler({ query: "billing", since: "2026-09-01" })).status, "Success");
  // a file without front matter still gets a title, a date and is searchable
  const plain = await find.toolHandler({ query: "zebrafinding" });
  assert.equal(plain.sessions.length, 1);
  assert.equal(plain.sessions[0].title, "Plain notes");
  assert.match(plain.sessions[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await find.toolHandler({ query: "search", limit: 1 })).sessions.length, 1);
});

test("find_sessions reads one summary by id and refuses anything else", async () => {
  const r = await find.toolHandler({ read: "codex/2026-09-30_codex-refactor.md" });
  assert.equal(r.status, "Success");
  assert.match(r.content, /three files/);
  const claudeId = (await find.toolHandler({ agent: "claude", limit: 1 })).sessions[0].id;
  assert.equal((await find.toolHandler({ read: claudeId })).status, "Success");

  const outside = path.join(ROOT, "outside.md");
  fs.writeFileSync(outside, "outside secret");
  for (const id of ["claude/../../outside.md", "../outside.md", "claude/..\\..\\outside.md", "other/x.md", "claude/notes.txt", "codex/", "codex/missing.md", "/etc/passwd"]) {
    const x = await find.toolHandler({ read: id });
    assert.equal(x.error, true, id);
    assert.doesNotMatch(JSON.stringify(x), /outside secret/);
  }
});

test("find_sessions rejects bad arguments and explains a missing folder", async () => {
  assert.equal((await find.toolHandler({ agent: "gemini" })).error, true);
  assert.equal((await find.toolHandler({ since: "yesterday" })).error, true);
  fs.rmSync(path.join(CODEX, "02_Outbox"), { recursive: true, force: true });
  const r = await find.toolHandler({ query: "search" });
  assert.equal(r.status, "Success");
  assert.match(r.folders.codex, /not found/);
});

test("parseFrontmatter handles lists, quotes and a missing block", () => {
  const { meta, body } = find.parseFrontmatter('---\ntitle: "Quoted: yes"\ntags: [a, b]\n---\nBody');
  assert.equal(meta.title, "Quoted: yes");
  assert.deepEqual(meta.tags, ["a", "b"]);
  assert.equal(body, "Body");
  assert.deepEqual(find.parseFrontmatter("no header").meta, {});
});
