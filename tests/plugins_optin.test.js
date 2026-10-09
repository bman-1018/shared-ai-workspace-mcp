import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-optin-"));
const WS = path.join(ROOT, "Claude_Workspace");
fs.mkdirSync(WS, { recursive: true });
process.env.X9_ROOT = WS;
process.env.X9_ALLOW_PLUGIN_WRITE = "1";

const push = await import("../Hot_Plugins/panoptic_push.js");
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test("with X9_ALLOW_PLUGIN_WRITE=1 the plugin routes exist and still cannot escape", async () => {
  const cats = push.toolSchema.inputSchema.properties.category.enum;
  assert.ok(cats.includes("mcp_tools") && cats.includes("plugins"));
  const ok = await push.toolHandler({ filename: "Hot_Plugins/new.js", category: "mcp_tools", chunk_data: "//x", is_first_chunk: true, is_final_chunk: true });
  assert.equal(ok.status, "Success");
  assert.ok(fs.existsSync(path.join(WS, "_mcp_tools", "Hot_Plugins", "new.js")));
  await assert.rejects(push.toolHandler({ filename: "../../outside.js", category: "plugins", chunk_data: "x", is_first_chunk: true, is_final_chunk: true }));
});
