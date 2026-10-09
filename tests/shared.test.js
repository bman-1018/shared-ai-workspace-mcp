import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveInside } from "../Hot_Plugins/_shared.js";

const WIN_BASE = "C:\\base";
const POSIX_BASE = "/base";

test("resolveInside accepts normal names and sub-folders (Windows rules)", () => {
  assert.equal(resolveInside(WIN_BASE, "notes.md", path.win32), "C:\\base\\notes.md");
  assert.equal(resolveInside(WIN_BASE, "sub/dir/file.md", path.win32), "C:\\base\\sub\\dir\\file.md");
  assert.equal(resolveInside(WIN_BASE, "sub\\file.md", path.win32), "C:\\base\\sub\\file.md");
});

test("resolveInside accepts normal names (POSIX rules)", () => {
  assert.equal(resolveInside(POSIX_BASE, "a/b.md", path.posix), "/base/a/b.md");
});

const BAD_ANY = [
  "../x", "a/../../x", "a/..", "..", ".", "/etc/passwd", "x:y", "C:\\x", "C:x",
  "evil\0.js", "a|b", "a<b", "a>b", 'a"b', "a?b", "a*b", "", null, undefined, 123, {},
];
for (const bad of BAD_ANY) {
  test(`resolveInside rejects ${JSON.stringify(bad)} (Windows rules)`, () => {
    assert.throws(() => resolveInside(WIN_BASE, bad, path.win32));
  });
  test(`resolveInside rejects ${JSON.stringify(bad)} (POSIX rules)`, () => {
    assert.throws(() => resolveInside(POSIX_BASE, bad, path.posix));
  });
}

const BAD_WINDOWS_ONLY = ["..\\x", "a\\..\\..\\b", "\\\\server\\share\\x", "\\x", "sub\\..\\..\\x"];
for (const bad of BAD_WINDOWS_ONLY) {
  test(`resolveInside rejects ${JSON.stringify(bad)} (Windows rules)`, () => {
    assert.throws(() => resolveInside(WIN_BASE, bad, path.win32));
  });
}

test("resolveInside does not treat a sibling folder with the same prefix as inside", () => {
  assert.throws(() => resolveInside("C:\\app", "..\\app-secrets\\x", path.win32));
  assert.throws(() => resolveInside("/app", "../app-secrets/x", path.posix));
});
