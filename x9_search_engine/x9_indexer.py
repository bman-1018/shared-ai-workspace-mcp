import datetime
import glob
import os
import re
import sqlite3
import time
from pathlib import Path

# Same root as The Forge: set X9_ROOT to change the drive letter (default X:\Claude_Workspace).
X9_ROOT = os.environ.get("X9_ROOT") or r"X:\Claude_Workspace"
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

ALLOWED_EXTENSIONS = {".md", ".js", ".ts", ".json", ".py", ".txt", ".sql"}
MAX_FILE_BYTES = 1_000_000
# Files whose names say "secret" are never indexed, so search can't hand them to the model.
SENSITIVE_NAME = re.compile(
    r"(^|[._-])(secrets?|credentials?|service[-_]?account|private[-_]?key|id_rsa|id_ed25519)([._-]|$)",
    re.IGNORECASE,
)


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

    for base in index_roots():
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith('.')]
            if os.path.basename(root) == "07_Chat_History":
                dirs[:] = [d for d in dirs if d.lower() not in CHAT_HISTORY_RAW]

            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in ALLOWED_EXTENSIONS and not SENSITIVE_NAME.search(file) and not ACTION_LOG.search(file):
                    full_path = os.path.join(root, file)
                    try:
                        # Skip massive files to prevent memory blowout
                        if os.path.getsize(full_path) < MAX_FILE_BYTES:
                            with open(full_path, 'r', encoding='utf-8') as f:
                                content = f.read()
                            modified = datetime.date.fromtimestamp(os.path.getmtime(full_path)).isoformat()
                            cursor.execute(
                                'INSERT INTO x9_search (path, content, modified) VALUES (?, ?, ?)',
                                (full_path, content, modified)
                            )
                            indexed_count += 1
                    except Exception:
                        pass  # Silently skip locked/binary files

    conn.commit()
    conn.close()
    # On Windows the swap fails while a search has the old file open. Searches are short,
    # so a few retries are enough; if it still fails the old index stays in place.
    for attempt in range(5):
        try:
            os.replace(tmp_path, DB_PATH)
            break
        except PermissionError:
            if attempt == 4:
                os.remove(tmp_path)
                raise
            time.sleep(0.5)
    print(f"[X9 Indexer] Vault sealed. Indexed {indexed_count} files in {time.time() - start_time:.2f} seconds.")


if __name__ == "__main__":
    build_index()
