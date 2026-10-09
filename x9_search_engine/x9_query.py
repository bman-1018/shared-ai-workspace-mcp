import os
import sqlite3
import sys
import json
from pathlib import Path

# Default: x9_vault.db next to this script. Override with X9_DB_PATH.
DB_PATH = os.environ.get("X9_DB_PATH") or str(Path(__file__).resolve().parent / "x9_vault.db")

def search(query):
    try:
        # Open read-only: searching must never be able to modify the index
        conn = sqlite3.connect(Path(DB_PATH).resolve().as_uri() + "?mode=ro", uri=True)
        cursor = conn.cursor()
        
        # FTS5 Match with Snippet generation
        # snippet() returns the context surrounding the keyword, wrapped in >> << 
        cursor.execute('''
            SELECT path, snippet(x9_search, 1, '>>', '<<', '...', 64) 
            FROM x9_search 
            WHERE content MATCH ? 
            ORDER BY rank 
            LIMIT 15
        ''', (query,))
        
        results = cursor.fetchall()
        conn.close()
        
        output = [{"path": row[0], "context": row[1]} for row in results]
        print(json.dumps(output))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        search(sys.argv[1])