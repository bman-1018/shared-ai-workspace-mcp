import datetime
import glob
import os
import re
import sqlite3
import stat
import time
from pathlib import Path

import x9_vectors

# Same root as The Forge: X9_ROOT, or the default for this operating system
# (X:\Claude_Workspace on Windows, ~/AI_Workspace/Claude_Workspace elsewhere).
X9_ROOT = os.environ.get("X9_ROOT") or (
    r"X:\Claude_Workspace" if os.name == "nt"
    else os.path.join(os.path.expanduser("~"), "AI_Workspace", "Claude_Workspace"))
# Default: x9_vault.db next to this script. Override with X9_DB_PATH.
DB_PATH = os.environ.get("X9_DB_PATH") or str(Path(__file__).resolve().parent / "x9_vault.db")

# Folders that are never indexed. Add more names with X9_INDEX_SKIP (comma separated).
IGNORED_DIRS = {".git", "node_modules", ".venv", "__pycache__", "chat_widget",
                "_temp", "_recon_archive"}
# Inside 07_Chat_History: the Forge action log repeats every earlier tool result, so
# indexing it makes search return logs of old searches instead of your documents, and the
# raw Cowork and Chat copies are bulky duplicates. The readable markdown exports in
# Readable_Logs are real conversations and stay searchable.
ACTION_LOG = re.compile(r"_Forge_Action_Log\.jsonl?$", re.IGNORECASE)
CHAT_HISTORY_RAW = {"cowork", "chat"}
IGNORED_DIRS |= {d.strip() for d in (os.environ.get("X9_INDEX_SKIP") or "").split(",") if d.strip()}
# The semantic search model sits next to these scripts, often inside the workspace. Its
# tokenizer.json is 700 KB of vocabulary that would flood search results. Skipped by full
# path, so a workspace folder that happens to be called "models" is still indexed.
SKIP_PATHS = {os.path.normcase(os.path.abspath(p)) for p in
              (Path(__file__).resolve().parent / "models", os.environ.get("X9_MODEL_DIR") or "") if p}

ALLOWED_EXTENSIONS = {".md", ".js", ".ts", ".json", ".py", ".txt", ".sql"}
MAX_FILE_BYTES = 1_000_000
# Files whose names say "secret" are never indexed, so search can't hand them to the model.
SENSITIVE_NAME = re.compile(
    r"(^|[._-])(secrets?|credentials?|service[-_]?account|private[-_]?key|id_rsa|id_ed25519)([._-]|$)",
    re.IGNORECASE,
)


_OPEN_FLAGS = (os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
               | getattr(os, "O_BINARY", 0))


def is_link(path):
    """A symlink, or on Windows a junction (os.walk does not treat junctions as links)."""
    isjunction = getattr(os.path, "isjunction", None)
    return os.path.islink(path) or bool(isjunction and isjunction(path))


def is_inside(real_path, real_root):
    """True if real_path is real_root or below it. Both must already be real paths."""
    path_c, root_c = os.path.normcase(real_path), os.path.normcase(real_root)
    try:
        return os.path.commonpath([path_c, root_c]) == root_c
    except ValueError:  # different drives on Windows
        return False


def read_indexable(path, real_root=None):
    """(text, mtime) for a regular file under MAX_FILE_BYTES, else None.

    Links are never followed: a notes.md that points at a file outside the workspace
    would otherwise put that file's contents in the index (and the name filter above
    only sees the link's name). Four cases are covered:
    - a symlink or junction: refused by the lstat check before opening;
    - one swapped in after that check: O_NOFOLLOW refuses it where the platform has it,
      and everywhere (including Windows, where O_NOFOLLOW is 0) the open file must be
      the same file the check saw;
    - a folder on the way swapped for a link after os.walk listed it: with real_root
      given, the file's real path must still be inside it;
    - a hard link: it looks like an ordinary file, so a file with more than one link
      is skipped.
    The size and type are checked on the open file, and O_NONBLOCK keeps a named pipe
    from hanging.
    """
    if is_link(path):
        return None
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode):
        return None
    fd = os.open(path, _OPEN_FLAGS)
    with os.fdopen(fd, "r", encoding="utf-8") as f:
        st = os.fstat(f.fileno())
        if (st.st_dev, st.st_ino) != (before.st_dev, before.st_ino):
            return None
        if st.st_nlink > 1:
            return None
        if real_root is not None and not is_inside(os.path.realpath(path), real_root):
            return None
        # Skip massive files to prevent memory blowout
        if not stat.S_ISREG(st.st_mode) or st.st_size >= MAX_FILE_BYTES:
            return None
        return f.read(), st.st_mtime


def index_roots():
    """The Claude workspace, plus a sibling Codex workspace if there is one (read only)."""
    roots = [X9_ROOT]
    if os.environ.get("X9_INDEX_CODEX") != "0":
        codex = os.environ.get("X9_CODEX_ROOT") or os.path.join(
            os.path.dirname(os.path.normpath(X9_ROOT)), "Codex_Workspace")
        if os.path.isdir(codex) and os.path.normcase(os.path.abspath(codex)) != os.path.normcase(os.path.abspath(X9_ROOT)):
            roots.append(codex)
    return roots


def build_index():
    print("[X9 Indexer] Initializing FTS5 Vault...")

    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)

    # Build into a temporary file and swap it in at the end, so a search that runs while
    # the index is being rebuilt always sees a complete index.
    # The name includes the process id so two Forge instances never share a file.
    tmp_path = DB_PATH + f".building.{os.getpid()}"
    for stale in (tmp_path, tmp_path + "-journal"):
        if os.path.exists(stale):
            os.remove(stale)
    # Leftovers from a run that was killed (older than a day, so a live run is never touched).
    for old in glob.glob(glob.escape(DB_PATH) + ".building.*"):
        try:
            if time.time() - os.path.getmtime(old) > 86400:
                os.remove(old)
        except OSError:
            # Another run may have removed it first, or it is still locked; the next run tries again.
            pass

    conn = sqlite3.connect(tmp_path)
    cursor = conn.cursor()

    # path and content are searchable; modified is stored only to show in results.
    cursor.execute('''
        CREATE VIRTUAL TABLE x9_search
        USING fts5(path, content, modified UNINDEXED, tokenize='trigram')
    ''')

    indexed_count = 0
    start_time = time.time()
    docs = []  # kept for the semantic index: (path, content, modified, mtime)

    for base in index_roots():
        # The root itself may be a link (the user chose it); everything below must stay in it.
        real_base = os.path.realpath(base)
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith('.')
                       and os.path.normcase(os.path.abspath(os.path.join(root, d))) not in SKIP_PATHS
                       and not is_link(os.path.join(root, d))]
            if os.path.basename(root) == "07_Chat_History":
                dirs[:] = [d for d in dirs if d.lower() not in CHAT_HISTORY_RAW]

            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in ALLOWED_EXTENSIONS and not SENSITIVE_NAME.search(file) and not ACTION_LOG.search(file):
                    full_path = os.path.join(root, file)
                    try:
                        found = read_indexable(full_path, real_base)
                        if found is not None:
                            content, mtime = found
                            modified = datetime.date.fromtimestamp(mtime).isoformat()
                            cursor.execute(
                                'INSERT INTO x9_search (path, content, modified) VALUES (?, ?, ?)',
                                (full_path, content, modified)
                            )
                            docs.append((full_path, content, modified, mtime))
                            indexed_count += 1
                    except Exception:
                        pass  # Silently skip locked/binary files

    conn.commit()
    conn.close()
    # On Windows the swap fails while a search has the old file open. Searches are short,
    # so a few retries are enough; if it still fails the old index stays in place.
    x9_vectors.swap_in(tmp_path, DB_PATH)
    print(f"[X9 Indexer] Vault sealed. Indexed {indexed_count} files in {time.time() - start_time:.2f} seconds.")

    # Semantic index (optional). X9_SEMANTIC_BUDGET_SECONDS limits the time spent embedding
    # in one run; the Forge sets it so a background refresh never runs for too long.
    try:
        budget = float(os.environ.get("X9_SEMANTIC_BUDGET_SECONDS") or 0)
    except ValueError:
        budget = 0
    try:
        x9_vectors.build(docs, DB_PATH, budget_seconds=budget)
    except Exception as e:
        # The keyword index is already in place; a semantic failure must not undo it.
        print(f"[X9 Indexer] Semantic index failed: {e}")
        raise SystemExit(2)


if __name__ == "__main__":
    build_index()
