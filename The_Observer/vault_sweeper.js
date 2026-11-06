/**
 * The_Observer/vault_sweeper.js
 * Copies the chat log (audit.jsonl) of each Claude Desktop agent-mode (Cowork)
 * session to 07_Chat_History\Cowork on the drive. Only new or changed logs are copied.
 * Works wherever Claude Desktop runs (Windows, macOS). If the session folder does not
 * exist, there is nothing to copy and the script does nothing.
 */

import fs from 'fs-extra';
import path from 'path';
import { claudeDataDir, workspaceRoot } from '../the_forge/platform_paths.js';

// Claude Desktop's data folder: %APPDATA%\Claude on Windows, ~/Library/Application Support/Claude
// on macOS. X9_CLAUDE_DATA_DIR overrides it.
const SOURCE_PROFILE = claudeDataDir();
if (!SOURCE_PROFILE) {
    console.error("APPDATA is not set, so the Claude Desktop folder cannot be found. Set X9_CLAUDE_DATA_DIR.");
    process.exit(1);
}
// Same root as The Forge: X9_ROOT, or the default for this operating system.
const X9_ROOT = workspaceRoot();
const COWORK_DEST = path.join(X9_ROOT, "07_Chat_History", "Cowork");

// Copies ONLY the chat log file (audit.jsonl) from each session. Everything else in
// the session folders (uploads, outputs, caches, debug files) stays where it is.
const COPY_ONLY_FILE = 'audit.jsonl';
const SKIP_DIRS = new Set(['debug', 'latest', 'logs', 'node_modules']);

const copyFilter = async (src, dest) => {
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

    // Only copy if the source is newer than the copy on the drive.
    try {
        const destStat = await fs.stat(dest);
        if (srcStat.mtimeMs <= destStat.mtimeMs) return false;
    } catch (e) {
        // Destination does not exist yet, proceed with copy
    }
    return true;
};

async function sweepVault() {
    await fs.ensureDir(COWORK_DEST);

    const coworkSource = path.join(SOURCE_PROFILE, 'local-agent-mode-sessions');
    if (await fs.pathExists(coworkSource)) {
        try {
            await fs.copy(coworkSource, COWORK_DEST, {
                overwrite: true,
                preserveTimestamps: true, // the flattener compares timestamps to skip unchanged logs
                filter: copyFilter
            });
        } catch (err) {
            // A non-zero exit makes the Forge write this to its log (mcp-server-The_Forge.log).
            console.error(`[Observer] Copy failed: ${err.message}`);
            process.exitCode = 1;
        }
    }
}

sweepVault();
