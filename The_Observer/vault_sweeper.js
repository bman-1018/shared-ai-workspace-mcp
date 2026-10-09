/**
 * The_Observer/vault_sweeper.js
 * Version: 2.0.0 (Delta Sync Ghost Mode)
 */

import fs from 'fs-extra';
import path from 'path';

if (!process.env.APPDATA) {
    console.error("APPDATA is not set. The Observer only supports Windows.");
    process.exit(1);
}
const SOURCE_PROFILE = path.join(process.env.APPDATA, 'Claude');
// Same root as The Forge: set X9_ROOT to change the drive letter (default X:\Claude_Workspace).
const X9_ROOT = path.resolve(process.env.X9_ROOT || "X:\\Claude_Workspace");
const HISTORY_DIR = path.join(X9_ROOT, "07_Chat_History");

const FOLDERS = {
    Cowork: path.join(HISTORY_DIR, "Cowork"),
    // Code: path.join(HISTORY_DIR, "Code")  // DISABLED 2026-03-26 - raw JSONL stays on C: drive
};

// FILTER: copies ONLY the chat log file (audit.jsonl) from each session, and only
// when it is new or changed. Everything else in the session folders (uploads,
// outputs, caches, debug files) stays where it is.
const COPY_ONLY_FILE = 'audit.jsonl';
const SKIP_DIRS = new Set(['debug', 'latest', 'logs', 'node_modules']);

const stealthFilter = async (src, dest) => {
    const basename = path.basename(src);
    let srcStat;
    try {
        srcStat = await fs.stat(src);
    } catch (e) {
        return false;
    }
    if (srcStat.isDirectory()) {
        return !SKIP_DIRS.has(basename); // walk into folders so audit.jsonl can be found
    }
    if (basename !== COPY_ONLY_FILE) return false;

    // Delta Check: only copy if the source is newer than the destination
    try {
        const destStat = await fs.stat(dest);
        if (srcStat.mtimeMs <= destStat.mtimeMs) return false;
    } catch (e) {
        // Destination does not exist yet, proceed with copy
    }
    return true;
};

async function sweepVault() {
    for (const folder of Object.values(FOLDERS)) {
        await fs.ensureDir(folder);
    }

    const coworkSource = path.join(SOURCE_PROFILE, 'local-agent-mode-sessions');
    const codeSource = path.join(SOURCE_PROFILE, 'claude-code-sessions');

    if (await fs.pathExists(coworkSource)) {
        try {
            await fs.copy(coworkSource, FOLDERS.Cowork, { 
                overwrite: true, 
                preserveTimestamps: true, // CRITICAL: Preserves true file age
                filter: stealthFilter 
            });
        } catch (err) {}
    }

    // DISABLED 2026-03-26 - Claude Code sessions no longer synced to X9.
    // Raw JSONL remains on C: drive at ~/.claude/projects/ if needed.
    // if (await fs.pathExists(codeSource)) {
    //     try {
    //         await fs.copy(codeSource, FOLDERS.Code, { 
    //             overwrite: true, 
    //             preserveTimestamps: true,
    //             filter: stealthFilter 
    //         });
    //     } catch (err) {}
    // }
}

sweepVault();