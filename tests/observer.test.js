import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OBSERVER = path.join(REPO, "The_Observer");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-observer-"));
const APPDATA = path.join(ROOT, "AppData");
const WS = path.join(ROOT, "Claude_Workspace");
const SESS = path.join(APPDATA, "Claude", "local-agent-mode-sessions", "acct", "org", "local_abc12345");
fs.mkdirSync(path.join(SESS, "uploads"), { recursive: true });
fs.mkdirSync(path.join(SESS, "outputs"), { recursive: true });
fs.mkdirSync(path.join(SESS, "debug"), { recursive: true });
fs.mkdirSync(WS, { recursive: true });
const lines = [
  { type: "user", message: { role: "user", content: "hello from the user" }, _audit_timestamp: "2026-10-01T10:00:00Z" },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello from the assistant" }] } },
];
fs.writeFileSync(path.join(SESS, "audit.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
fs.writeFileSync(path.join(SESS, "uploads", "private.pdf"), "pdf bytes");
fs.writeFileSync(path.join(SESS, "outputs", "report.txt"), "an output file");
fs.writeFileSync(path.join(SESS, "cookies.json"), "{}");
fs.writeFileSync(path.join(SESS, "debug", "audit.jsonl"), "debug copy that must be skipped");

const env = { ...process.env, APPDATA, X9_ROOT: WS, USERPROFILE: ROOT, HOME: ROOT };
const run = (script) => execFileSync(process.execPath, [script], { cwd: OBSERVER, env, stdio: "pipe" });
function allFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? allFiles(p, out) : out.push(p);
  }
  return out;
}

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test("the sweeper copies only audit.jsonl", () => {
  run("vault_sweeper.js");
  const copied = allFiles(path.join(WS, "07_Chat_History", "Cowork")).map((p) => path.basename(p));
  assert.deepEqual(copied, ["audit.jsonl"]);
  const text = fs.readFileSync(allFiles(path.join(WS, "07_Chat_History", "Cowork"))[0], "utf8");
  assert.doesNotMatch(text, /debug copy/);
});

test("a changed log is copied again", () => {
  const dest = allFiles(path.join(WS, "07_Chat_History", "Cowork"))[0];
  fs.appendFileSync(path.join(SESS, "audit.jsonl"), JSON.stringify({ message: { role: "user", content: "second message" } }) + "\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(SESS, "audit.jsonl"), future, future);
  run("vault_sweeper.js");
  assert.match(fs.readFileSync(dest, "utf8"), /second message/);
});

test("the flattener writes a readable markdown file", () => {
  run("vault_flattener.js");
  const md = allFiles(path.join(WS, "07_Chat_History", "Readable_Logs", "Cowork")).filter((p) => p.endsWith(".md"));
  assert.equal(md.length, 1);
  const text = fs.readFileSync(md[0], "utf8");
  assert.match(text, /hello from the user/);
  assert.match(text, /hello from the assistant/);
});

test("the sweeper stops cleanly when APPDATA is missing", () => {
  const noApp = { ...process.env, X9_ROOT: WS };
  delete noApp.APPDATA;
  assert.throws(() => execFileSync(process.execPath, ["vault_sweeper.js"], { cwd: OBSERVER, env: noApp, stdio: "pipe" }));
});
