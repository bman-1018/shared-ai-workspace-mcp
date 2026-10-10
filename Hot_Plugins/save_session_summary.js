// ============================================================
// SAVE SESSION SUMMARY - Forge Hot Plugin
// Writes a detailed written summary of a conversation (not a transcript) so that
// a later chat, or the other agent, can pick the work up without the original chat.
// Claude writes to 04_Session_Notes in the Claude workspace only. Codex has read
// access to that folder and writes its own summaries to its own workspace.
// ============================================================

import fs from "fs/promises";
import { CLAUDE_SUMMARY_DIR, localDate, slugify, resolveInside } from "./_shared.js";
import { redactSecrets } from "../the_forge/log_sanitize.js";

export const toolName = "save_session_summary";

export const toolSchema = {
  description:
    "Save a detailed summary of this conversation to the workspace so it can be found later and shared with Codex. " +
    "Call it when a substantial conversation or work session ends, when the user says to wrap up or save, " +
    "or after a major decision. Write what a person who was not there would need: what was asked, what was done, " +
    "what was decided and why, what is unfinished, and the exact names of files, folders, branches and commands involved. " +
    "This is a summary, not a transcript: do not paste the conversation. Never include passwords, API keys or tokens. " +
    "Each call creates a new file and never overwrites an earlier one.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short specific title, for example: Fixed X9 search index and added session summaries." },
      summary: { type: "string", description: "The detailed description of the conversation, in prose or short paragraphs. Several paragraphs is normal." },
      decisions: { type: "array", items: { type: "string" }, description: "Decisions made, each with the reason." },
      files: { type: "array", items: { type: "string" }, description: "Files, folders, repos, branches, links touched or discussed." },
      open_items: { type: "array", items: { type: "string" }, description: "Things left unfinished or still undecided." },
      next_steps: { type: "array", items: { type: "string" }, description: "What the next session (or Codex) should do first." },
      tags: { type: "array", items: { type: "string" }, description: "A few lowercase keywords people would search for." },
      project: { type: "string", description: "Project or area name, if there is one." }
    },
    required: ["title", "summary"]
  },
  annotations: { title: "Save session summary", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
};

const MAX_TITLE = 120;
const MAX_SUMMARY = 30000;
const MAX_ITEMS = 50;
const MAX_ITEM_CHARS = 1000;

function oneLine(s, max) {
  return redactSecrets(String(s)).replace(/\s+/g, " ").trim().slice(0, max);
}

function list(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of strings.`);
  return value.slice(0, MAX_ITEMS).map((v) => oneLine(v, MAX_ITEM_CHARS)).filter(Boolean);
}

function section(heading, items) {
  return items.length ? `\n## ${heading}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "";
}

export function buildSummaryMarkdown({ title, summary, decisions, files, open_items, next_steps, tags, project, date, time }) {
  const front = [
    "---",
    "type: session_summary",
    "agent: claude",
    `date: ${date}`,
    `time: ${time}`,
    `title: ${title}`,
    ...(project ? [`project: ${project}`] : []),
    `tags: [${tags.join(", ")}]`,
    "---",
    "",
  ].join("\n");
  return (
    front +
    `# ${title}\n\n## Summary\n${summary.trim()}\n` +
    section("Decisions", decisions) +
    section("Files and links", files) +
    section("Open items", open_items) +
    section("Next steps", next_steps)
  );
}

export const toolHandler = async (args) => {
  const a = args || {};
  if (typeof a.title !== "string" || a.title.trim() === "") throw new Error("title must be a non-empty string.");
  if (typeof a.summary !== "string" || a.summary.trim().length < 20) {
    throw new Error("summary must be a string with a real description of the conversation (at least 20 characters).");
  }
  if (a.summary.length > MAX_SUMMARY) throw new Error(`summary is over ${MAX_SUMMARY} characters. Condense it.`);

  const rawText = JSON.stringify([a.title, a.summary, a.decisions, a.files, a.open_items, a.next_steps, a.tags, a.project]);
  const title = oneLine(a.title, MAX_TITLE);
  const summary = redactSecrets(a.summary).replace(/\r\n/g, "\n");
  const now = new Date();
  const date = localDate(now);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const tags = list(a.tags, "tags").map((t) => slugify(t, 30)).filter((t, i, all) => all.indexOf(t) === i).slice(0, 12);
  const project = a.project ? oneLine(a.project, 80) : "";

  const markdown = buildSummaryMarkdown({
    title, summary, project, date, time, tags,
    decisions: list(a.decisions, "decisions"),
    files: list(a.files, "files"),
    open_items: list(a.open_items, "open_items"),
    next_steps: list(a.next_steps, "next_steps"),
  });

  await fs.mkdir(CLAUDE_SUMMARY_DIR, { recursive: true });
  const base = `${date}_${slugify(title)}`;
  // "wx" fails if the file exists, so an earlier summary is never overwritten.
  for (let n = 1; n <= 50; n++) {
    const filename = n === 1 ? `${base}.md` : `${base}-${n}.md`;
    const target = resolveInside(CLAUDE_SUMMARY_DIR, filename);
    try {
      await fs.writeFile(target, markdown, { encoding: "utf8", flag: "wx" });
      const redacted = redactSecrets(rawText) !== rawText;
      return {
        status: "Success",
        message: "Session summary saved. Codex can read it from the Claude workspace, and find_sessions will list it.",
        path: target,
        ...(redacted ? { note: "Something that looked like a secret was replaced with [REDACTED]." } : {}),
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
  throw new Error("Too many summaries with this title today. Use a more specific title.");
};
