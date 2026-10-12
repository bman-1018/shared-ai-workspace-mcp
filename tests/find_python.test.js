import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const fresh = async () => (await import(`../the_forge/find_python.js?x=${Math.random()}`)).findPython;
const original = process.env.X9_PYTHON;
test.after(() => { if (original === undefined) delete process.env.X9_PYTHON; else process.env.X9_PYTHON = original; });

function anyPython() {
  for (const c of ["python", "python3", "py"]) { try { execFileSync(c, ["-c", "pass"], { stdio: "ignore" }); return c; } catch {} }
  return null;
}
const PY = anyPython();

test("X9_PYTHON is used as given, without fallback, even if it does not exist", async () => {
  process.env.X9_PYTHON = "definitely-not-a-python";
  assert.equal((await fresh())(), "definitely-not-a-python");
});

test("without X9_PYTHON a working python is found", { skip: PY ? false : "no python here" }, async () => {
  delete process.env.X9_PYTHON;
  const found = (await fresh())();
  assert.doesNotThrow(() => execFileSync(found, ["-c", "import sqlite3"], { stdio: "ignore" }));
});
