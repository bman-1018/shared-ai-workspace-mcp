import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer, waitForExit } from "./helpers/mcp_stdio.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRIDGE = path.join(REPO, "readonly_bridge", "index.js");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-bridge-"));
const PROJ = path.join(ROOT, "proj");
const SIBLING = path.join(ROOT, "proj-secrets");
const OUTSIDE = path.join(ROOT, "outside");
for (const d of [path.join(PROJ, "src"), SIBLING, OUTSIDE]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(PROJ, "src", "app.js"), "console.log('hello');\n");
fs.writeFileSync(path.join(PROJ, ".env"), "TOKEN=abc\n");
fs.writeFileSync(path.join(PROJ, "key.pem"), "pem\n");
fs.writeFileSync(path.join(PROJ, "big.txt"), "x".repeat(600 * 1024));
fs.writeFileSync(path.join(PROJ, "bin.dat"), Buffer.from([1, 2, 0, 3, 4]));
fs.writeFileSync(path.join(SIBLING, "x.txt"), "sibling secret");
fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), "outside secret");
let linked = true;
try { fs.symlinkSync(OUTSIDE, path.join(PROJ, "link"), "junction"); } catch { linked = false; }

let srv;
test.before(async () => { srv = startServer([BRIDGE], { env: { READONLY_BRIDGE_DIR: PROJ } }); await srv.init(); });
test.after(() => { srv?.stop(); fs.rmSync(ROOT, { recursive: true, force: true }); });

test("it only offers read tools", async () => {
  const names = (await srv.listTools()).map((t) => t.name).sort();
  assert.deepEqual(names, ["git_shadow_reader", "list_shadow_directory", "panoptic_shadow_ingest", "read_shadow_file"]);
});

test("reads a normal file and lists a folder", async () => {
  const r = await srv.callTool("read_shadow_file", { target_path: "src/app.js" });
  assert.equal(r.isError, false);
  assert.match(r.text, /hello/);
  const l = await srv.callTool("list_shadow_directory", { target_path: "." });
  assert.match(l.text, /src/);
});

test("refuses paths outside the folder, including a sibling with the same prefix", async () => {
  for (const p of ["../outside/secret.txt", "../proj-secrets/x.txt", path.join(SIBLING, "x.txt"), "src/../../proj-secrets/x.txt"]) {
    const r = await srv.callTool("read_shadow_file", { target_path: p });
    assert.equal(r.isError, true, p);
    assert.doesNotMatch(r.text, /sibling secret|outside secret/);
  }
});

test("refuses a link that points outside the folder", { skip: linked ? false : "cannot create links here" }, async () => {
  const r = await srv.callTool("read_shadow_file", { target_path: "link/secret.txt" });
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.text, /outside secret/);
});

test("secret-looking files are blocked by default", async () => {
  for (const p of [".env", "key.pem"]) {
    const r = await srv.callTool("read_shadow_file", { target_path: p });
    assert.equal(r.isError, true, p);
    assert.doesNotMatch(r.text, /TOKEN=abc/);
  }
});

test("size and binary limits", async () => {
  const big = await srv.callTool("read_shadow_file", { target_path: "big.txt" });
  assert.equal(big.isError, true);
  assert.match(big.text, /limit/);
  const bin = await srv.callTool("read_shadow_file", { target_path: "bin.dat" });
  assert.equal(bin.isError, true);
  assert.match(bin.text, /[Bb]inary/);
});

test("multi-file read respects locks and limits", async () => {
  const r = await srv.callTool("panoptic_shadow_ingest", { target_paths: ["src/app.js", ".env", "../outside/secret.txt"] });
  assert.match(r.text, /hello/);
  assert.match(r.text, /SECURITY LOCK/);
  assert.doesNotMatch(r.text, /TOKEN=abc|outside secret/);
  const many = await srv.callTool("panoptic_shadow_ingest", { target_paths: Array.from({ length: 51 }, () => "src/app.js") });
  assert.equal(many.isError, true);
  assert.match(many.text, /Too many files/);
});

test("git tool only accepts the fixed read-only commands", async () => {
  for (const command of ["push", "commit -m x", "status; echo hi", "--version", "log -n 5 --all", "config --list"]) {
    const r = await srv.callTool("git_shadow_reader", { command });
    assert.equal(r.isError, true, command);
  }
});

test("secret blocking can be turned off on purpose", async () => {
  const open = startServer([BRIDGE], { env: { READONLY_BRIDGE_DIR: PROJ, READONLY_BRIDGE_BLOCK_SECRETS: "0" } });
  try {
    await open.init();
    const r = await open.callTool("read_shadow_file", { target_path: ".env" });
    assert.equal(r.isError, false);
    assert.match(r.text, /TOKEN=abc/);
  } finally { open.stop(); }
});

test("it refuses to start without READONLY_BRIDGE_DIR", async () => {
  const env = { ...process.env };
  delete env.READONLY_BRIDGE_DIR;
  const child = spawn(process.execPath, [BRIDGE], { env, stdio: "ignore" });
  assert.equal(await waitForExit(child), 1);
});

test("every bridge tool is marked read only", async () => {
  const tools = await srv.listTools();
  assert.equal(tools.length, 4);
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name);
    assert.equal(t.annotations?.destructiveHint, false, t.name);
  }
});
