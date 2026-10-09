// Makes tool inputs and outputs safe to write to the action log:
//  - long strings are cut (so file contents pushed through a tool are not copied into the log)
//  - values under secret-looking keys are replaced
//  - strings that look like API keys or bearer tokens are replaced
// This is a best-effort filter, not a guarantee. See SECURITY.md.

const MAX_STRING = 2000;
const MAX_ENTRY_CHARS = 20000;
const MAX_DEPTH = 6;
const SECRET_KEY = /(token|secret|passw(or)?d|api[_-]?key|authorization|credential|private[_-]?key)/i;
const SECRET_VALUE = [
  /\b(sk|pk|rk)[-_](live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

function cleanString(s) {
  let out = s;
  for (const re of SECRET_VALUE) out = out.replace(re, "[REDACTED]");
  if (out.length > MAX_STRING) {
    out = out.slice(0, MAX_STRING) + `...[truncated ${out.length - MAX_STRING} chars]`;
  }
  return out;
}

function walk(value, depth) {
  if (typeof value === "string") return cleanString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[too deep]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => walk(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 50)) {
    out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : walk(v, depth + 1);
  }
  return out;
}

export function sanitizeForLog(value) {
  return walk(value, 0);
}

// One log line: compact JSON, capped in total size.
export function formatLogLine(entry) {
  let line = JSON.stringify(sanitizeForLog(entry));
  if (line.length > MAX_ENTRY_CHARS) {
    line = JSON.stringify({
      timestamp: entry.timestamp,
      tool_executed: entry.tool_executed,
      status: entry.status,
      note: `entry too large (${line.length} chars), details dropped`,
    });
  }
  return line + "\n";
}
