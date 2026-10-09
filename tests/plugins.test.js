// Runs in its own process: X9_ROOT must be set before the plugins are imported.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
