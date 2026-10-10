import json
import os
import re
import sqlite3
import sys
from pathlib import Path

# Default: x9_vault.db next to this script. Override with X9_DB_PATH.
DB_PATH = os.environ.get("X9_DB_PATH") or str(Path(__file__).resolve().parent / "x9_vault.db")

DEFAULT_LIMIT = 10
MAX_LIMIT = 25
MAX_TERMS = 8


def parse_terms(query):
    """Split a query into terms. Words are separate terms; "quoted text" stays one phrase."""
    terms = []
    for m in re.finditer(r'"([^"]+)"|(\S+)', query):
        term = (m.group(1) or m.group(2)).strip().strip('"').strip()
        if term:
            terms.append(term)
    return terms[:MAX_TERMS]


def search(query, limit=DEFAULT_LIMIT):
    limit = max(1, min(int(limit), MAX_LIMIT))
    terms = parse_terms(query)
    if not terms:
        return []

    # Open read-only: searching must never be able to modify the index
    conn = sqlite3.connect(Path(DB_PATH).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(x9_search)")}
        modified_col = "modified" if "modified" in columns else "''"

        # The trigram index needs at least 3 characters per term. Shorter terms are
        # checked with a plain substring test instead.
        long_terms = [t for t in terms if len(t) >= 3]
        short_terms = [t for t in terms if len(t) < 3]
        extra_sql = ""
        extra_params = []
        for t in short_terms:
            extra_sql += " AND (instr(lower(path), lower(?)) > 0 OR instr(lower(content), lower(?)) > 0)"
            extra_params += [t, t]

        if long_terms:
            # Every term must appear in the file name or in the text. Terms are quoted, so
            # characters such as - : * ( ) AND OR are plain text and never FTS5 syntax.
            match = " AND ".join('"' + t.replace('"', '""') + '"' for t in long_terms)
            rows = conn.execute(
                "SELECT path, " + modified_col + ", snippet(x9_search, 1, '>>', '<<', '...', 40) "
                "FROM x9_search WHERE x9_search MATCH ?" + extra_sql +
                " ORDER BY bm25(x9_search, 8.0, 1.0) LIMIT ?",
                [match] + extra_params + [limit],
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT path, " + modified_col + ", substr(content, 1, 240) "
                "FROM x9_search WHERE 1=1" + extra_sql + " LIMIT ?",
                extra_params + [limit],
            ).fetchall()
    finally:
        conn.close()

    return [{"path": r[0], "modified": r[1] or None, "context": " ".join((r[2] or "").split())} for r in rows]


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no query given"}))
        return
    limit = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_LIMIT
    try:
        if not os.path.exists(DB_PATH):
            raise FileNotFoundError("The search index does not exist yet. The Forge builds it a few seconds after it starts (this needs Python), or run x9_indexer.py once.")
        print(json.dumps(search(sys.argv[1], limit)))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
