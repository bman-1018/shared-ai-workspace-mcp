// The flattener builds output file names from chat log contents, so those names must
// never leave Readable_Logs (CWE-22).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OBSERVER = path.join(REPO, "The_Observer");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-observer-names-"));
const WS = path.join(ROOT, "Claude_Workspace");
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function allFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? allFiles(p, out) : out.push(p);
  }
  return out;
}

test("the flattener never uses a log's date to leave the output folder", () => {
  const logs = [
    ["local_def67890", "../../../../escaped"],
    ["local_def67891", "..\\..\\..\\escaped2"],
    ["local_def67892", 8.64e15 + 1], // a number Date can't represent
    ["local_def67893", "2026-10-01T10:00:00Z"], // a normal date is kept
  ];
  for (const [id, date] of logs) {
    const dir = path.join(WS, "07_Chat_History", "Cowork", "acct", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "audit.jsonl"), JSON.stringify({ message: { role: "user", content: "crafted date" }, _audit_timestamp: date }) + "\n");
  }
  execFileSync(process.execPath, ["vault_flattener.js"], { cwd: OBSERVER, env: { ...process.env, X9_ROOT: WS }, stdio: "pipe" });

  assert.deepEqual(allFiles(ROOT).filter((p) => /escaped/.test(path.basename(p))), []);
  const out = path.join(WS, "07_Chat_History", "Readable_Logs", "Cowork");
  for (const [id] of logs) {
    const md = allFiles(out).filter((p) => p.includes(id));
    assert.equal(md.length, 1, id);
    assert.equal(path.dirname(md[0]), out);
    assert.match(path.basename(md[0]), /^\d{4}-\d{2}-\d{2}_crafted_date_/);
  }
  assert.ok(allFiles(out).some((p) => path.basename(p).startsWith("2026-10-01_crafted_date_[local_def67893]")));
});
