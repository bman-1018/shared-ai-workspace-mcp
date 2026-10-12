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

test("redactSecrets hides secrets without shortening the text", async () => {
  const { redactSecrets } = await import("../the_forge/log_sanitize.js");
  const long = "word ".repeat(1000);
  const out = redactSecrets(`${long} sk-live-abcdefghijklmnopqrstuvwx ${long}`);
  assert.doesNotMatch(out, /abcdefghijklmnopqrstuvwx/);
  assert.match(out, /\[REDACTED\]/);
  assert.ok(out.length > 9000, "must not truncate");
});

test("more key shapes are hidden, plain sentences are not", async () => {
  const { redactSecrets } = await import("../the_forge/log_sanitize.js");
  const secrets = [
    "AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "github_pat_11ABCDEFG0abcdefghijkl_mnop",
    "shpat_0123456789abcdef0123456789abcdef",
    "whsec_abcdefghijklmnop1234",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc123def456",
    "postgres://user:pass@db.example.com/app",
    "password: hunter2x9",
    "api key = abc123def456",
    "hf_abcdefghijklmnopqrstuvwxyz012345",
  ];
  for (const s of secrets) assert.equal(redactSecrets(`value ${s} end`).includes("[REDACTED]"), true, s);
  for (const ok of ["token: refresh logic is fine", "secret: management plan", "see http://localhost:3000/path", "the password reset flow"]) {
    assert.equal(redactSecrets(ok), ok, ok);
  }
});
