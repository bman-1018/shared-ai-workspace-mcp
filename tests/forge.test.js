import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers/mcp_stdio.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-forge-"));
const WS = path.join(ROOT, "Claude_Workspace");
// A copy of the tool folders, so the test can add and remove plugins without touching the repo.
const TOOLS = path.join(WS, "_mcp_tools");
fs.mkdirSync(TOOLS, { recursive: true });
for (const d of ["the_forge", "Hot_Plugins", "The_Observer"]) {
  fs.cpSync(path.join(REPO, d), path.join(TOOLS, d), { recursive: true, filter: (s) => !s.includes("node_modules") });
}
for (const d of ["the_forge", "The_Observer"]) {
  fs.symlinkSync(path.join(REPO, d, "node_modules"), path.join(TOOLS, d, "node_modules"), "junction");
}
const HOT = path.join(TOOLS, "Hot_Plugins");
const HISTORY = path.join(WS, "07_Chat_History");

let srv;
test.before(async () => {
  srv = startServer([path.join(TOOLS, "the_forge", "index.js")], { env: { X9_ROOT: WS } });
  await srv.init();
});
test.after(() => { srv?.stop(); fs.rmSync(ROOT, { recursive: true, force: true }); });

test("the Forge lists its plugins and runs one", async () => {
  const names = (await srv.listTools()).map((t) => t.name).sort();
  for (const n of ["hello_forge", "panoptic_push", "submit_code_plan", "x9_search", "x9_workspace_mapper"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  const r = await srv.callTool("hello_forge", {});
  assert.equal(r.isError, false);
  assert.match(r.text, /online/);
});

test("a tool that tries to escape its folder fails and is reported as an error", async () => {
  const r = await srv.callTool("panoptic_push", { filename: "../../evil.js", category: "memory", chunk_data: "x", is_first_chunk: true, is_final_chunk: true });
  assert.equal(r.isError, true);
  assert.ok(!fs.existsSync(path.join(WS, "evil.js")));
  assert.ok(!fs.existsSync(path.join(ROOT, "evil.js")));
});

test("the action log is valid JSON lines with long and secret values removed", async () => {
  const secret = "sk-live-" + "a1b2c3d4e5f6g7h8i9j0k1l2";
  await srv.callTool("panoptic_push", { filename: "log-test.md", category: "memory", chunk_data: secret + " " + "z".repeat(6000), is_first_chunk: true, is_final_chunk: false });
  const files = fs.readdirSync(HISTORY).filter((f) => f.endsWith("_Forge_Action_Log.jsonl"));
  assert.equal(files.length, 1);
  const raw = fs.readFileSync(path.join(HISTORY, files[0]), "utf8");
  const entries = raw.trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(entries.length >= 3);
  assert.doesNotMatch(raw, new RegExp(secret));
  assert.ok(raw.length < 10000, "log should not hold the 6000 character payload in full");
  assert.ok(entries.every((e) => e.tool_executed && e.status));
});

test("hot reload: a new plugin appears, then disappears, without restarting", async () => {
  const plugin = path.join(HOT, "zz_hot_test.js");
  fs.writeFileSync(plugin, `export const toolName = "zz_hot_test";
export const toolSchema = { description: "temp", inputSchema: { type: "object", properties: {}, required: [] } };
export const toolHandler = async () => ({ status: "Success", message: "hot" });
`);
  await srv.waitForNotification("notifications/tools/list_changed", 15000);
  assert.ok((await srv.listTools()).some((t) => t.name === "zz_hot_test"));
  assert.match((await srv.callTool("zz_hot_test", {})).text, /hot/);

  fs.writeFileSync(path.join(HOT, "zz_broken.js"), "export const toolName = ;;; not javascript");
  await srv.waitForNotification("notifications/tools/list_changed", 15000);
  assert.ok((await srv.listTools()).some((t) => t.name === "zz_hot_test"), "a broken plugin must not remove the others");

  fs.unlinkSync(plugin);
  fs.unlinkSync(path.join(HOT, "zz_broken.js"));
  await srv.waitForNotification("notifications/tools/list_changed", 15000);
  assert.ok(!(await srv.listTools()).some((t) => t.name === "zz_hot_test"));
});

test("logging can be turned off", async () => {
  const ws2 = path.join(ROOT, "ws2");
  fs.mkdirSync(ws2, { recursive: true });
  const off = startServer([path.join(TOOLS, "the_forge", "index.js")], { env: { X9_ROOT: ws2, X9_FORGE_LOG: "off" } });
  try {
    await off.init();
    await off.callTool("hello_forge", {});
    assert.ok(!fs.existsSync(path.join(ws2, "07_Chat_History")));
  } finally { off.stop(); }
});
