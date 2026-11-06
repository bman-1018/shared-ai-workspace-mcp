// Runs in its own process: X9_ROOT must be set before the plugins are imported.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-plugins-"));
const WS = path.join(ROOT, "Claude_Workspace");
fs.mkdirSync(WS, { recursive: true });
process.env.X9_ROOT = WS;
delete process.env.X9_ALLOW_PLUGIN_WRITE;

const push = await import("../Hot_Plugins/panoptic_push.js");
const plan = await import("../Hot_Plugins/submit_code_plan.js");
const mapper = await import("../Hot_Plugins/x9_workspace_mapper.js");
const hello = await import("../Hot_Plugins/hello_forge.js");

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test("hello_forge answers", async () => {
  const r = await hello.toolHandler({});
  assert.equal(r.status, "Success");
});

test("panoptic_push assembles a file from chunks", async () => {
  const a = await push.toolHandler({ filename: "notes/big.md", category: "session_notes", chunk_data: "one ", is_first_chunk: true, is_final_chunk: false });
  assert.equal(a.status, "Processing");
  const b = await push.toolHandler({ filename: "notes/big.md", category: "session_notes", chunk_data: "two", is_first_chunk: false, is_final_chunk: true });
  assert.equal(b.status, "Success");
  assert.equal(fs.readFileSync(path.join(WS, "04_Session_Notes", "notes", "big.md"), "utf8"), "one two");
});

test("panoptic_push refuses paths that escape the folder", async () => {
  const bad = ["../escape.txt", "a/../../escape.txt", "/abs.txt", "C:\\abs.txt", "x:stream"];
  // On Windows a backslash is a path separator, so these must be refused there too.
  // On Linux and macOS a backslash is a legal file name character, so they are not paths.
  if (process.platform === "win32") bad.push("..\\escape.txt", "a\\..\\..\\escape.txt", "\\\\server\\share\\x");
  for (const filename of bad) {
    let refused = false;
    try {
      const r = await push.toolHandler({ filename, category: "session_notes", chunk_data: "x", is_first_chunk: true, is_final_chunk: true });
      refused = !!r.error;
    } catch { refused = true; }
    assert.ok(refused, `should refuse ${filename}`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "escape.txt")));
  assert.ok(!fs.existsSync(path.join(WS, "escape.txt")));
});

test("panoptic_push rejects unknown and prototype category names", async () => {
  for (const category of ["nope", "__proto__", "constructor", "toString"]) {
    await assert.rejects(push.toolHandler({ filename: "a.md", category, chunk_data: "x", is_first_chunk: true, is_final_chunk: true }));
  }
});

test("panoptic_push caps chunk size", async () => {
  await assert.rejects(push.toolHandler({ filename: "huge.md", category: "memory", chunk_data: "x".repeat(200_001), is_first_chunk: true, is_final_chunk: true }));
});

test("panoptic_push cannot write into code or plugin folders by default", async () => {
  const cats = push.toolSchema.inputSchema.properties.category.enum;
  assert.ok(!cats.includes("mcp_tools"));
  assert.ok(!cats.includes("plugins"));
  await assert.rejects(push.toolHandler({ filename: "evil.js", category: "mcp_tools", chunk_data: "x", is_first_chunk: true, is_final_chunk: true }));
});

test("submit_code_plan keeps the file inside 06_Code_Plans", async () => {
  const r = await plan.toolHandler({ feature_name: "../../evil/../name", files_to_modify: ["a.js"], step_by_step_plan: "do it" });
  assert.equal(r.status, "Success");
  const files = fs.readdirSync(path.join(WS, "06_Code_Plans"));
  assert.equal(files.length, 1);
  assert.match(files[0], /_PLAN\.md$/);
  assert.doesNotMatch(files[0], /[\\/]/);
  assert.ok(!fs.existsSync(path.join(ROOT, "evil")));
});

test("submit_code_plan validates its input", async () => {
  await assert.rejects(plan.toolHandler({ feature_name: "", files_to_modify: [], step_by_step_plan: "x" }));
  await assert.rejects(plan.toolHandler({ feature_name: "x", files_to_modify: "no", step_by_step_plan: "x" }));
});

test("workspace mapper lists a folder and handles bad input", async () => {
  fs.mkdirSync(path.join(WS, "01_Active_Projects", "demo"), { recursive: true });
  fs.writeFileSync(path.join(WS, "01_Active_Projects", "demo", "a.md"), "x");
  const r = await mapper.toolHandler({ category: "active_projects", maxDepth: 999, maxEntries: -5 });
  assert.match(r.tree, /demo\//);
  assert.match(r.tree, /a\.md/);
  const s = await mapper.toolHandler({ category: "root", mode: "summary" });
  assert.match(s.tree, /01_Active_Projects/);
  const bad = await mapper.toolHandler({ category: "__proto__" });
  assert.equal(bad.error, true);
});

// ---- Links already in the workspace must not redirect a write (CWE-59) ----
// File symlinks need Developer Mode or admin on Windows; folder junctions do not.
function tryLink(target, link, type) {
  try { fs.symlinkSync(target, link, type); return true; } catch { return false; }
}
const PLUGIN_TEMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "Hot_Plugins", "_temp");

test("panoptic_push refuses a category folder or sub-folder that is a link", async (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "x9-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  if (!tryLink(outside, path.join(WS, "03_Final_Outputs"), "junction")) return t.skip("cannot create links here");
  const r = await push.toolHandler({ filename: "a.md", category: "final_outputs", chunk_data: "x", is_first_chunk: true, is_final_chunk: true });
  assert.equal(r.error, true);
  assert.match(r.message, /link/);

  fs.mkdirSync(path.join(WS, "memory"), { recursive: true });
  assert.ok(tryLink(outside, path.join(WS, "memory", "sub"), "junction"));
  const r2 = await push.toolHandler({ filename: "sub/b.md", category: "memory", chunk_data: "x", is_first_chunk: true, is_final_chunk: true });
  assert.equal(r2.error, true);
  // A folder that doesn't exist yet is never created through a link either.
  const r3 = await push.toolHandler({ filename: "sub/new/c.md", category: "memory", chunk_data: "x", is_first_chunk: true, is_final_chunk: true });
  assert.equal(r3.error, true);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("panoptic_push refuses a final file or temp part file that is a link", async (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "x9-outside-"));
  const victim = path.join(outside, "victim.txt");
  fs.writeFileSync(victim, "keep");
  const part = path.join(PLUGIN_TEMP, "memory__part-link.md.part");
  t.after(() => { fs.rmSync(outside, { recursive: true, force: true }); fs.rmSync(part, { force: true }); });
  fs.mkdirSync(path.join(WS, "memory"), { recursive: true });
  if (!tryLink(victim, path.join(WS, "memory", "final-link.md"), "file")) return t.skip("cannot create file symlinks here");
  const r = await push.toolHandler({ filename: "final-link.md", category: "memory", chunk_data: "overwritten", is_first_chunk: true, is_final_chunk: true });
  assert.equal(r.error, true);
  assert.match(r.message, /link/);

  fs.mkdirSync(PLUGIN_TEMP, { recursive: true });
  assert.ok(tryLink(victim, part, "file"));
  const r2 = await push.toolHandler({ filename: "part-link.md", category: "memory", chunk_data: "overwritten", is_first_chunk: true, is_final_chunk: false });
  assert.equal(r2.error, true);
  // Appending to the part file, and reading it back to assemble it, are refused too.
  const r3 = await push.toolHandler({ filename: "part-link.md", category: "memory", chunk_data: "more", is_first_chunk: false, is_final_chunk: true });
  assert.equal(r3.error, true);
  assert.ok(!fs.existsSync(path.join(WS, "memory", "part-link.md")), "the outside file's contents must not be copied in");
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("panoptic_push and submit_code_plan refuse a file with another hard link", async (t) => {
  const victim = path.join(ROOT, "hardlink-victim.txt");
  fs.writeFileSync(victim, "keep");
  fs.mkdirSync(path.join(WS, "memory"), { recursive: true });
  try { fs.linkSync(victim, path.join(WS, "memory", "hard.md")); } catch { return t.skip("cannot create hard links here"); }
  const r = await push.toolHandler({ filename: "hard.md", category: "memory", chunk_data: "overwritten", is_first_chunk: true, is_final_chunk: true });
  assert.equal(r.error, true);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");

  const date = new Date().toISOString().split("T")[0];
  fs.mkdirSync(path.join(WS, "06_Code_Plans"), { recursive: true });
  fs.linkSync(victim, path.join(WS, "06_Code_Plans", `${date}_hardlinked_PLAN.md`));
  const p = await plan.toolHandler({ feature_name: "hardlinked", files_to_modify: [], step_by_step_plan: "overwrite" });
  assert.equal(p.error, true);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("submit_code_plan refuses a plan file that is a link", async (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "x9-outside-"));
  const victim = path.join(outside, "victim.txt");
  fs.writeFileSync(victim, "keep");
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const date = new Date().toISOString().split("T")[0];
  fs.mkdirSync(path.join(WS, "06_Code_Plans"), { recursive: true });
  if (!tryLink(victim, path.join(WS, "06_Code_Plans", `${date}_linked_PLAN.md`), "file")) return t.skip("cannot create file symlinks here");
  const r = await plan.toolHandler({ feature_name: "linked", files_to_modify: ["a.js"], step_by_step_plan: "overwrite" });
  assert.equal(r.error, true);
  assert.match(r.message, /link/);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("submit_code_plan refuses a 06_Code_Plans folder that is a link", async (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "x9-outside-"));
  // PLAN_DIR is fixed at import, so move the real folder aside and put a link in its place.
  const planDir = path.join(WS, "06_Code_Plans");
  const saved = planDir + ".saved";
  fs.mkdirSync(planDir, { recursive: true });
  fs.renameSync(planDir, saved);
  t.after(() => {
    fs.rmSync(planDir, { recursive: true, force: true });
    fs.renameSync(saved, planDir);
    fs.rmSync(outside, { recursive: true, force: true });
  });
  if (!tryLink(outside, planDir, "junction")) return t.skip("cannot create links here");
  const r = await plan.toolHandler({ feature_name: "via-link", files_to_modify: [], step_by_step_plan: "x" });
  assert.equal(r.error, true);
  assert.deepEqual(fs.readdirSync(outside), []);
});
