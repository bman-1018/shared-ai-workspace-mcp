/**
 * The_Observer/vault_flattener.js
 * Version: 3.1.0 (Phantom-Proof & Strict Identity)
 */

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import os from 'os';

// Same root as The Forge: set X9_ROOT to change the drive letter (default X:\Claude_Workspace).
const X9_ROOT = path.resolve(process.env.X9_ROOT || "X:\\Claude_Workspace");
const HISTORY_DIR = path.join(X9_ROOT, "07_Chat_History");
const OUTPUT_DIR = path.join(HISTORY_DIR, "Readable_Logs");
const CLAUDE_CODE_VAULT = path.join(process.env.USERPROFILE || os.homedir(), ".claude", "projects");

async function findAuditFiles(dir, isCowork, fileList = []) {
    if (!await fs.pathExists(dir)) return fileList;
    try {
        const items = await fs.readdir(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                await findAuditFiles(fullPath, isCowork, fileList);
            } else {
                // STRICT TARGETING: Cowork MUST be exactly 'audit.jsonl'. Ignores all temp/backup files.
                if (isCowork && item === 'audit.jsonl') {
                    fileList.push({ path: fullPath, mtime: stat.mtimeMs });
                } else if (!isCowork && item.endsWith('.jsonl') && !item.startsWith('.') && !item.startsWith('~')) {
                    fileList.push({ path: fullPath, mtime: stat.mtimeMs });
                }
            }
        }
    } catch (err) {}
    return fileList;
}

async function flattenEverything() {
    await fs.ensureDir(path.join(OUTPUT_DIR, "Cowork"));
    // await fs.ensureDir(path.join(OUTPUT_DIR, "Claude_Code"));  // DISABLED 2026-03-26

    // Pass 'true' to activate strict targeting for Cowork
    const coworkFiles = await findAuditFiles(path.join(HISTORY_DIR, "Cowork"), true);
    // DISABLED 2026-03-26 - Claude Code logs no longer flattened to X9.
    // Raw JSONL remains on C: drive at ~/.claude/projects/ if needed.
    // const codeFiles = await findAuditFiles(CLAUDE_CODE_VAULT, false); 
    
    const allFiles = [
        ...coworkFiles.map(f => ({ ...f, type: 'Cowork' })),
        // ...codeFiles.map(f => ({ ...f, type: 'Claude_Code' }))
    ];

    for (const fileObj of allFiles) {
        try {
            // BULLETPROOF IDENTITY: Extract Anthropic's true UUID
            let shortId = "log";
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
                        let rawDate = entry._audit_timestamp || entry.createdAt || entry.timestamp;
                        if (typeof rawDate === 'number') {
                            sessionDate = new Date(rawDate).toISOString().split('T')[0];
                        } else if (typeof rawDate === 'string') {
                            sessionDate = rawDate.split('T')[0];
                        } else {
                            sessionDate = new Date(fileObj.mtime).toISOString().split('T')[0];
                        }

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
                const targetPath = path.join(OUTPUT_DIR, fileObj.type, fileName);

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
        } catch (err) {}
    }
}

flattenEverything();