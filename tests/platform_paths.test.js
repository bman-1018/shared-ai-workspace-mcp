import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { defaultWorkspaceRoot, workspaceRoot, claudeDataDir } from "../the_forge/platform_paths.js";

test("the default workspace is X:\\Claude_Workspace on Windows and under the home folder elsewhere", () => {
  assert.equal(defaultWorkspaceRoot({ platform: "win32", home: "C:\\Users\\a" }), "X:\\Claude_Workspace");
  assert.equal(defaultWorkspaceRoot({ platform: "darwin", home: "/Users/a" }), "/Users/a/AI_Workspace/Claude_Workspace");
  assert.equal(defaultWorkspaceRoot({ platform: "linux", home: "/home/a" }), "/home/a/AI_Workspace/Claude_Workspace");
});

test("X9_ROOT wins over the default", () => {
  const dir = path.resolve("some", "workspace");
  assert.equal(workspaceRoot({ X9_ROOT: dir }), dir);
  assert.equal(workspaceRoot({}), path.resolve(defaultWorkspaceRoot()));
});

test("the Claude Desktop data folder is found per operating system", () => {
  assert.equal(claudeDataDir({ platform: "win32", env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" } }), "C:\\Users\\a\\AppData\\Roaming\\Claude");
  assert.equal(claudeDataDir({ platform: "win32", env: {} }), null);
  assert.equal(claudeDataDir({ platform: "darwin", env: {}, home: "/Users/a" }), "/Users/a/Library/Application Support/Claude");
  assert.equal(claudeDataDir({ platform: "linux", env: {}, home: "/home/a" }), "/home/a/.config/Claude");
  assert.equal(claudeDataDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/x" }, home: "/home/a" }), "/x/Claude");
  assert.equal(claudeDataDir({ platform: "darwin", env: { X9_CLAUDE_DATA_DIR: "/custom" } }), "/custom");
});
