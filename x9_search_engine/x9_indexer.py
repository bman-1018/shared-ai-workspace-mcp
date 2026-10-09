import os
import re
import sqlite3
import time
from pathlib import Path

# Same root as The Forge: set X9_ROOT to change the drive letter (default X:\Claude_Workspace).
X9_ROOT = os.environ.get("X9_ROOT") or r"X:\Claude_Workspace"
# Default: x9_vault.db next to this script. Override with X9_DB_PATH.
DB_PATH = os.environ.get("X9_DB_PATH") or str(Path(__file__).resolve().parent / "x9_vault.db")
IGNORED_DIRS = {".git", "node_modules", ".venv", "__pycache__", "chat_widget"}
ALLOWED_EXTENSIONS = {".md", ".js", ".ts", ".json", ".py", ".txt", ".sql"}
# Files whose names say "secret" are never indexed, so search can't hand them to the model.
SENSITIVE_NAME = re.compile(
    r"(^|[._-])(secrets?|credentials?|service[-_]?account|private[-_]?key|id_rsa|id_ed25519)([._-]|$)",
    re.IGNORECASE,
)

def build_index():
    print("[X9 Indexer] Initializing FTS5 Vault...")
    
    # Ensure the directory exists before trying to create the DB file
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create the Full-Text Search Virtual Table
    cursor.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS x9_search 
        USING fts5(path, content, tokenize='trigram')
    ''')
    
    # Clear old index for a fresh run
    cursor.execute('DELETE FROM x9_search')
    
    indexed_count = 0
    start_time = time.time()

    for root, dirs, files in os.walk(X9_ROOT):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith('.')]
        
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in ALLOWED_EXTENSIONS and not SENSITIVE_NAME.search(file):
                full_path = os.path.join(root, file)
                try:
                    # Skip massive files to prevent memory blowout (>1MB)
                    if os.path.getsize(full_path) < 1_000_000:
                        with open(full_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        cursor.execute(
                            'INSERT INTO x9_search (path, content) VALUES (?, ?)',
                            (full_path, content)
                        )
                        indexed_count += 1
                except Exception:
                    pass # Silently skip locked/binary files

    conn.commit()
    conn.close()
    print(f"[X9 Indexer] Vault sealed. Indexed {indexed_count} files in {time.time() - start_time:.2f} seconds.")

if __name__ == "__main__":
    build_index()