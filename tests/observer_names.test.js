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

// ---- Links must not pull outside files in or push the output out (CWE-59) ----
// The markdown is indexed by x9_search, so a linked log would put an outside file in search.
// File symlinks need Developer Mode or admin on Windows; junctions and hard links do not.
const tryLink = (target, link, type) => { try { fs.symlinkSync(target, link, type); return true; } catch { return false; } };
const logLine = (text) => JSON.stringify({ message: { role: "user", content: text }, _audit_timestamp: "2026-10-02T10:00:00Z" }) + "\n";
const flatten = (ws) => execFileSync(process.execPath, ["vault_flattener.js"], { cwd: OBSERVER, env: { ...process.env, X9_ROOT: ws }, stdio: "pipe" });
const outputText = (ws) => allFiles(path.join(ws, "07_Chat_History", "Readable_Logs")).map((p) => fs.readFileSync(p, "utf8")).join("\n");

test("the flattener skips logs that are links or hard links, and linked folders", (t) => {
  const ws = path.join(ROOT, "links_ws");
  const outside = path.join(ROOT, "links_outside");
  const cowork = path.join(ws, "07_Chat_History", "Cowork", "acct");
  fs.mkdirSync(path.join(outside, "local_aaa00002"), { recursive: true });
  fs.mkdirSync(path.join(cowork, "local_aaa00001"), { recursive: true });
  fs.writeFileSync(path.join(cowork, "local_aaa00001", "audit.jsonl"), logLine("ordinarylogtext"));
  fs.writeFileSync(path.join(outside, "local_aaa00002", "audit.jsonl"), logLine("linkedfolderlogtext"));
  fs.writeFileSync(path.join(outside, "hard.jsonl"), logLine("hardlinkedlogtext"));
  fs.writeFileSync(path.join(outside, "sym.jsonl"), logLine("symlinkedlogtext"));

  const dirLinked = tryLink(path.join(outside, "local_aaa00002"), path.join(cowork, "local_aaa00002"), "junction");
  fs.mkdirSync(path.join(cowork, "local_aaa00003"));
  let hardLinked = true;
  try { fs.linkSync(path.join(outside, "hard.jsonl"), path.join(cowork, "local_aaa00003", "audit.jsonl")); } catch { hardLinked = false; }
  fs.mkdirSync(path.join(cowork, "local_aaa00004"));
  const fileLinked = tryLink(path.join(outside, "sym.jsonl"), path.join(cowork, "local_aaa00004", "audit.jsonl"), "file");
  if (!dirLinked && !hardLinked && !fileLinked) return t.skip("cannot create links here");

  flatten(ws);
  const text = outputText(ws);
  assert.match(text, /ordinarylogtext/, "an ordinary log is still converted");
  assert.doesNotMatch(text, /linkedfolderlogtext/);
  assert.doesNotMatch(text, /hardlinkedlogtext/);
  assert.doesNotMatch(text, /symlinkedlogtext/);
});

test("the flattener never writes through a linked output folder", (t) => {
  const ws = path.join(ROOT, "outlink_ws");
  const outside = path.join(ROOT, "outlink_outside");
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(ws, "07_Chat_History", "Readable_Logs"), { recursive: true });
  const log = path.join(ws, "07_Chat_History", "Cowork", "acct", "local_bbb00001", "audit.jsonl");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, logLine("outputfolderlogtext"));
  if (!tryLink(outside, path.join(ws, "07_Chat_History", "Readable_Logs", "Cowork"), "junction")) return t.skip("cannot create links here");

  assert.throws(() => flatten(ws), "a non-zero exit reports the refused folder");
  assert.deepEqual(fs.readdirSync(outside), []);
});
