// A link swapped in between the helpers' checks and the open must still be refused
// (CWE-59). On Windows O_NOFOLLOW is 0, so the open itself follows the link; these
// tests swap the link in at the moment of the open and drop O_NOFOLLOW, so the
// checks made after the open are tested on every OS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileInside, readFileInside } from "../Hot_Plugins/_shared.js";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "x9-swap-"));
const WS = path.join(ROOT, "ws");
const OUTSIDE = path.join(ROOT, "outside");
fs.mkdirSync(WS);
fs.mkdirSync(OUTSIDE);
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const realOpen = fs.promises.open;

// Run swap() just before the helper opens `target`, and open the way Windows does.
function swapOnOpen(t, target, swap) {
  fs.promises.open = async (p, flags, mode) => {
    if (path.resolve(p) === path.resolve(target)) {
      fs.promises.open = realOpen;
      swap();
    }
    return realOpen(p, typeof flags === "number" ? flags & ~O_NOFOLLOW : flags, mode);
  };
  t.after(() => { fs.promises.open = realOpen; });
}

function canSymlinkFiles() {
  const probe = path.join(ROOT, "probe-link");
  try { fs.symlinkSync(path.join(ROOT, "nothing"), probe, "file"); fs.unlinkSync(probe); return true; } catch { return false; }
}
const FILE_LINKS = canSymlinkFiles();
const NO_FILE_LINKS = FILE_LINKS ? false : "file symlinks need Developer Mode or admin on Windows";

test("write: a new file name swapped for a link before the open is refused", { skip: NO_FILE_LINKS }, async (t) => {
  const victim = path.join(OUTSIDE, "victim1.txt");
  fs.writeFileSync(victim, "keep");
  const target = path.join(WS, "new.md");
  swapOnOpen(t, target, () => fs.symlinkSync(victim, target, "file"));
  await assert.rejects(writeFileInside(WS, target, "overwritten"), /link/);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("write: an existing file swapped for a link before the open is refused", { skip: NO_FILE_LINKS }, async (t) => {
  const victim = path.join(OUTSIDE, "victim2.txt");
  fs.writeFileSync(victim, "keep");
  const target = path.join(WS, "existing.md");
  fs.writeFileSync(target, "original");
  swapOnOpen(t, target, () => { fs.unlinkSync(target); fs.symlinkSync(victim, target, "file"); });
  await assert.rejects(writeFileInside(WS, target, "overwritten"), /link/);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("write: a folder swapped for a junction before the open is refused, nothing written outside", async (t) => {
  const sub = path.join(WS, "sub");
  fs.mkdirSync(sub);
  const target = path.join(sub, "note.md");
  let linked = false;
  swapOnOpen(t, target, () => {
    fs.renameSync(sub, sub + "-moved");
    try { fs.symlinkSync(OUTSIDE, sub, "junction"); linked = true; } catch {}
  });
  // The swap runs inside the call, so wait for it to finish before checking `linked`.
  const outcome = await writeFileInside(WS, target, "should not land outside").then(() => null, (err) => err);
  if (!linked) return t.skip("cannot create links here");
  assert.match(String(outcome && outcome.message), /link/);
  // The open may leave an empty file behind; the data must never be written there.
  const leaked = path.join(OUTSIDE, "note.md");
  if (fs.existsSync(leaked)) assert.equal(fs.statSync(leaked).size, 0);
});

test("read: a file swapped for a link before the open is refused", { skip: NO_FILE_LINKS }, async (t) => {
  const secret = path.join(OUTSIDE, "secret.txt");
  fs.writeFileSync(secret, "outside secret");
  const target = path.join(WS, "part.txt");
  fs.writeFileSync(target, "mine");
  swapOnOpen(t, target, () => { fs.unlinkSync(target); fs.symlinkSync(secret, target, "file"); });
  await assert.rejects(readFileInside(WS, target), /link/);
});

test("write and read still work when nothing is swapped", async () => {
  const target = path.join(WS, "deep", "er", "ok.md");
  await writeFileInside(WS, target, "hello");
  assert.equal((await readFileInside(WS, target)).toString(), "hello");
  await writeFileInside(WS, target, " again", { append: true });
  assert.equal(fs.readFileSync(target, "utf8"), "hello again");
});
