"""The semantic half of search: a store of text chunks and their embeddings.

Kept in its own file (x9_vectors.db, next to x9_vault.db) so the keyword index can be
rebuilt from scratch every time while embeddings, which are slow to compute, are reused
for every file whose text has not changed. Like the keyword index, it is built into a
temporary file and swapped in, so a search never sees a half-built store.
"""
import glob
import hashlib
import os
import sqlite3
import time
from pathlib import Path

from x9_embed import CHUNK_CHARS, CHUNK_OVERLAP, chunk_text, get_embedder, semantic_disabled_reason

SCHEMA_VERSION = 1
# Embed this many chunks at a time across files (small files would otherwise make tiny batches).
FLUSH_CHUNKS = 64
# Cosine similarity below which a semantic match is treated as unrelated. Measured on a real
# 21,700-chunk workspace: off-topic queries ("recipe for banana bread") topped out at 0.51 to
# 0.65, real questions matched at 0.69 to 0.75. Override with X9_SEMANTIC_MIN_SCORE.
DEFAULT_MIN_SCORE = 0.65


def vector_db_path(db_path):
    return os.environ.get("X9_VECTOR_DB_PATH") or os.path.join(os.path.dirname(os.path.abspath(db_path)), "x9_vectors.db")


def incomplete_marker(db_path):
    """Exists while a semantic build is unfinished, so the Forge continues it after a restart."""
    return vector_db_path(db_path) + ".incomplete"


def _signature(embedder):
    return f"{embedder.model_id}|chunks={CHUNK_CHARS}/{CHUNK_OVERLAP}|v{SCHEMA_VERSION}"


def swap_in(tmp_path, final_path, attempts=5):
    """os.replace with retries: on Windows the swap fails while a search has the file open."""
    for attempt in range(attempts):
        try:
            os.replace(tmp_path, final_path)
            return
        except PermissionError:
            if attempt == attempts - 1:
                os.remove(tmp_path)
                raise
            time.sleep(0.5)


def _load_previous(vec_path, signature):
    """content hash -> list of (chunk_no, text, vec bytes), from the last build if compatible."""
    if not os.path.exists(vec_path):
        return {}
    try:
        conn = sqlite3.connect(Path(vec_path).resolve().as_uri() + "?mode=ro", uri=True)
        try:
            meta = dict(conn.execute("SELECT key, value FROM meta"))
            if meta.get("signature") != signature:
                return {}  # different model or chunking: everything is embedded again
            previous, first_path = {}, {}
            for path, h, chunk_no, text, vec in conn.execute(
                    "SELECT path, file_hash, chunk_no, text, vec FROM chunks ORDER BY path, chunk_no"):
                # Identical files share a hash; keep one copy of their chunks.
                if first_path.setdefault(h, path) == path:
                    previous.setdefault(h, []).append((chunk_no, text, vec))
            return previous
        finally:
            conn.close()
    except sqlite3.Error:
        return {}


def build(docs, db_path, budget_seconds=0, log=print):
    """docs: list of (path, content, modified_date, mtime). budget_seconds > 0 limits the time
    spent embedding new text; files left over are embedded on the next run, newest first.
    Returns a dict of counts, or None when semantic search is off or not installed."""
    reason = semantic_disabled_reason()
    if reason:
        log(f"[X9 Indexer] Semantic index skipped: {reason}.")
        return None

    embedder = get_embedder()
    signature = _signature(embedder)
    vec_path = vector_db_path(db_path)
    previous = _load_previous(vec_path, signature)

    tmp_path = vec_path + f".building.{os.getpid()}"
    for stale in (tmp_path, tmp_path + "-journal"):
        if os.path.exists(stale):
            os.remove(stale)
    for old in glob.glob(glob.escape(vec_path) + ".building.*"):
        try:
            if time.time() - os.path.getmtime(old) > 86400:
                os.remove(old)
        except OSError:
            pass

    conn = sqlite3.connect(tmp_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("CREATE TABLE chunks (path TEXT, file_hash TEXT, chunk_no INTEGER, text TEXT, modified TEXT, vec BLOB)")
    conn.executemany("INSERT INTO meta VALUES (?, ?)", [("signature", signature), ("dims", str(embedder.dims))])
    insert = "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)"

    stats = {"reused": 0, "embedded": 0, "files_left": 0}
    pending = []
    for path, content, modified, mtime in docs:
        # Keyed by content only, so a moved or renamed file keeps its vectors (they were made
        # with the old file name in front; a small effect, not worth embedding it again).
        h = hashlib.sha256(content.encode("utf-8", "surrogatepass")).hexdigest()
        if h in previous:
            conn.executemany(insert, [(path, h, n, text, modified, vec) for n, text, vec in previous[h]])
            stats["reused"] += len(previous[h])
        else:
            pending.append((mtime, path, h, content, modified))

    # Newest files first, so the most recent work becomes searchable soonest.
    pending.sort(key=lambda p: p[0], reverse=True)
    # perf_counter, not time.time: on Windows time.time can advance in 15 ms steps, so a
    # short budget would never run out.
    started = time.perf_counter()
    batch = []  # (path, hash, chunk_no, text, modified, text_to_embed)

    def flush():
        if not batch:
            return
        vecs = embedder.embed_documents([b[5] for b in batch])
        conn.executemany(insert, [(p, h, n, t, m, v.tobytes()) for (p, h, n, t, m, _), v in zip(batch, vecs)])
        stats["embedded"] += len(batch)
        batch.clear()

    for i, (_, path, h, content, modified) in enumerate(pending):
        # At least one file per run, so a build always makes progress.
        if budget_seconds and i > 0 and time.perf_counter() - started > budget_seconds:
            stats["files_left"] = len(pending) - i
            break
        name = os.path.basename(path)
        for n, text in enumerate(chunk_text(content)):
            # The file name goes in front of each chunk: it often says what the text is about.
            batch.append((path, h, n, text, modified, f"{name}\n{text}"))
        if len(batch) >= FLUSH_CHUNKS:
            flush()
    flush()

    conn.commit()
    conn.close()
    # Up to 10 seconds: this file can hold minutes of embedding work, worth waiting for.
    swap_in(tmp_path, vec_path, attempts=20)
    log(f"[X9 Indexer] Semantic index: {stats['embedded']} chunks embedded, {stats['reused']} reused, "
        f"{time.perf_counter() - started:.1f} seconds.")
    marker = incomplete_marker(db_path)
    if stats["files_left"]:
        Path(marker).write_text(str(stats["files_left"]))
        log(f"[X9 Indexer] Semantic index incomplete: {stats['files_left']} files left for the next run.")
    elif os.path.exists(marker):
        os.remove(marker)
    return stats


def search(query, db_path, limit, min_score=None):
    """Returns (results, None) or (None, reason). Each result: path, modified, context, score.
    One result per file: its best-matching chunk."""
    reason = semantic_disabled_reason()
    if reason:
        return None, reason
    vec_path = vector_db_path(db_path)
    if not os.path.exists(vec_path):
        return None, "not built yet (the Forge builds it in the background; the first build can take a while)"
    if min_score is None:
        try:
            min_score = float(os.environ.get("X9_SEMANTIC_MIN_SCORE", DEFAULT_MIN_SCORE))
        except ValueError:
            min_score = DEFAULT_MIN_SCORE

    import numpy as np
    embedder = get_embedder()
    conn = sqlite3.connect(Path(vec_path).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        meta = dict(conn.execute("SELECT key, value FROM meta"))
        if meta.get("signature") != _signature(embedder):
            return None, "built with a different model; it is rebuilt on the next index refresh"
        rows = conn.execute("SELECT rowid, path, vec FROM chunks").fetchall()
        if not rows:
            return [], None
        matrix = np.frombuffer(b"".join(r[2] for r in rows), dtype=np.float32).reshape(len(rows), int(meta["dims"]))
        scores = matrix @ embedder.embed_query(query)

        results, seen = [], set()
        for i in np.argsort(-scores):
            if scores[i] < min_score or len(results) >= limit:
                break
            path = rows[i][1]
            if path in seen:
                continue
            seen.add(path)
            text, modified = conn.execute("SELECT text, modified FROM chunks WHERE rowid = ?", (rows[i][0],)).fetchone()
            results.append({"path": path, "modified": modified or None,
                            "context": " ".join(text.split())[:300], "score": round(float(scores[i]), 3)})
        return results, None
    finally:
        conn.close()
