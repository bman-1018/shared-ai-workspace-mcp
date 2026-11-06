/**
 * The_Observer/vault_flattener.js
 * Turns the copied Cowork chat logs (audit.jsonl) into readable markdown files in
 * 07_Chat_History\Readable_Logs\Cowork. Unchanged logs are skipped.
 */

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import { workspaceRoot } from '../the_forge/platform_paths.js';

// Same root as The Forge: X9_ROOT, or the default for this operating system.
const X9_ROOT = workspaceRoot();
const HISTORY_DIR = path.join(X9_ROOT, "07_Chat_History");
const OUTPUT_DIR = path.join(HISTORY_DIR, "Readable_Logs");

// The session date comes from the log and goes into a file name, so only a plain
// YYYY-MM-DD is used. Anything else ("../x", "a\\b", a bad number) falls back to
// the log file's modified date.
function isoDay(value, fallbackMs) {
    let day = "";
    if (typeof value === 'number') {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) day = d.toISOString().slice(0, 10);
    } else if (typeof value === 'string') {
        day = value.split('T')[0];
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date(fallbackMs).toISOString().slice(0, 10);
}

async function findAuditFiles(dir, fileList = []) {
    if (!await fs.pathExists(dir)) return fileList;
    try {
        const items = await fs.readdir(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                await findAuditFiles(fullPath, fileList);
            } else if (item === 'audit.jsonl') {
                // Exactly 'audit.jsonl': temp and backup copies are ignored.
                fileList.push({ path: fullPath, mtime: stat.mtimeMs });
            }
        }
    } catch (err) {
        console.error(`[Observer] Cannot list ${dir}: ${err.message}`);
        process.exitCode = 1;
    }
    return fileList;
}

async function flattenEverything() {
    await fs.ensureDir(path.join(OUTPUT_DIR, "Cowork"));

    const coworkFiles = await findAuditFiles(path.join(HISTORY_DIR, "Cowork"));
    const allFiles = coworkFiles.map(f => ({ ...f, type: 'Cowork' }));

    for (const fileObj of allFiles) {
        try {
            // Session ID from the folder name (local_<hex>), else the start of the file name.
            let shortId;
            const localMatch = fileObj.path.match(/local_[a-f0-9]+/i);
            if (localMatch) {
                shortId = localMatch[0]; // Extracts exactly "local_0cfab3fb"
            } else {
                const base = path.basename(fileObj.path, '.jsonl');
                shortId = base.substring(0, 8);
            }
            if (!shortId) shortId = "log";

            const fileStream = fs.createReadStream(fileObj.path);
            const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
            
            let mdContent = "";
            let sessionDate = "Unknown_Date";
            let title = "Session";
            let isFirst = true;

            for await (const line of rl) {
                try {
                    const entry = JSON.parse(line);
                    const msg = entry.message || entry; 

                    if (isFirst) {
                        sessionDate = isoDay(entry._audit_timestamp || entry.createdAt || entry.timestamp, fileObj.mtime);

                        const rawContent = msg.content || "";
                        title = typeof rawContent === 'string' && rawContent.length > 0 ? rawContent.substring(0, 40) : "Log";
                        title = title.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
                        
                        mdContent += `# Session: ${sessionDate}\n**System:** ${fileObj.type}\n**Session ID:** ${shortId}\n**Source:** ${fileObj.path}\n\n---\n\n`;
                        isFirst = false;
                    }

                    const role = (msg.role || entry.type || "System").toUpperCase();
                    let content = msg.content || msg.text || "";
                    
                    if (Array.isArray(content)) {
                        content = content.map(c => c.text || (c.type === 'tool_use' ? `🛠️ **Tool:** ${c.name}` : "")).join("\n");
                    }

                    if (content) mdContent += `### ${role}\n${content}\n\n---\n\n`;
                } catch (e) { /* silently skip unparseable lines */ }
            }

            if (mdContent && !isFirst) {
                const fileName = `${sessionDate}_${title}_[${shortId}].md`;
                const outDir = path.join(OUTPUT_DIR, fileObj.type);
                const targetPath = path.join(outDir, fileName);
                // Every part of the name is already reduced to safe characters; this
                // is a second check that the file stays in the output folder.
                if (path.dirname(targetPath) !== outDir) {
                    throw new Error(`Refusing an output name that leaves ${outDir}: ${fileName}`);
                }

                let needsUpdate = true;
                try {
                    const mdStat = await fs.stat(targetPath);
                    if (mdStat.mtimeMs >= fileObj.mtime) {
                        needsUpdate = false; 
                    }
                } catch (e) { }

                if (needsUpdate) {
                    await fs.writeFile(targetPath, mdContent);
                }
            }
        } catch (err) {
            console.error(`[Observer] Could not convert ${fileObj.path}: ${err.message}`);
            process.exitCode = 1;
        }
    }
}

flattenEverything();