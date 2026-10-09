import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeForLog, formatLogLine } from "../the_forge/log_sanitize.js";

test("long strings are cut", () => {
  const out = sanitizeForLog({ chunk_data: "a".repeat(5000) });
  assert.ok(out.chunk_data.length < 2100);
  assert.match(out.chunk_data, /truncated 3000 chars/);
});

test("secret-looking keys are hidden", () => {
  const out = sanitizeForLog({ apiKey: "abc", password: "x", Authorization: "y", ok: "fine" });
  assert.equal(out.apiKey, "[REDACTED]");
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.Authorization, "[REDACTED]");
  assert.equal(out.ok, "fine");
});

test("secret-looking values are hidden", () => {
  const text = "key sk-live-abcdefghijklmnopqrstuvwx and ghp_abcdefghijklmnopqrstuvwxyz0123 and Bearer abcdefghijklmnopqrstuv.123 AKIAABCDEFGHIJKLMNOP";
  const out = sanitizeForLog({ note: text });
  assert.doesNotMatch(out.note, /abcdefghijklmnopqrstuvwx/);
  assert.doesNotMatch(out.note, /AKIAABCDEFGHIJKLMNOP/);
  assert.match(out.note, /\[REDACTED\]/);
});

test("private key blocks are hidden", () => {
  const out = sanitizeForLog({ t: "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----" });
  assert.equal(out.t, "[REDACTED]");
});

test("each log line is one valid JSON object", () => {
  const line = formatLogLine({ timestamp: "t", tool_executed: "x", inputs: { a: 1 }, output: { b: "c" }, status: "SUCCESS" });
  assert.ok(line.endsWith("\n"));
  assert.equal(line.trim().split("\n").length, 1);
  assert.deepEqual(JSON.parse(line).inputs, { a: 1 });
});

test("a huge entry is replaced by a small note", () => {
  const big = {};
  for (let i = 0; i < 50; i++) big["k" + i] = "x".repeat(1900);
  const line = formatLogLine({ timestamp: "t", tool_executed: "x", inputs: big, output: big, status: "SUCCESS" });
  assert.ok(line.length < 1000);
  assert.match(JSON.parse(line).note, /too large/);
});

test("deep and wide objects do not blow up", () => {
  let deep = {}; let cur = deep;
  for (let i = 0; i < 50; i++) { cur.n = {}; cur = cur.n; }
  assert.doesNotThrow(() => sanitizeForLog(deep));
});
