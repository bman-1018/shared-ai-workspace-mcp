// Tiny MCP client for tests: starts a server over stdio and speaks newline-delimited JSON-RPC.
import { spawn } from "node:child_process";

export function startServer(args, { env = {}, cwd } = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buf = "";
  let stderr = "";
  let nextId = 1;
  let exited = null;
  const pending = new Map();
  const notifications = [];
  const waiters = [];

  child.stderr.on("data", (d) => { stderr += d; });
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg);
        pending.delete(msg.id);
      } else if (msg.method) {
        notifications.push(msg);
        for (const w of [...waiters]) {
          if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
        }
      }
    }
  });
  child.on("exit", (code) => {
    exited = code;
    for (const p of pending.values()) p.reject(new Error(`server exited with code ${code}\n${stderr}`));
    pending.clear();
  });

  const write = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  const request = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}\n${stderr}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (m) => { clearTimeout(t); resolve(m); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      write({ jsonrpc: "2.0", id, method, params });
    });

  return {
    child,
    get stderr() { return stderr; },
    get exitCode() { return exited; },
    async init() {
      const r = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      });
      write({ jsonrpc: "2.0", method: "notifications/initialized" });
      return r;
    },
    listTools: async () => (await request("tools/list")).result.tools,
    // Returns { isError, text } for a tools/call
    async callTool(name, args) {
      const r = await request("tools/call", { name, arguments: args });
      if (r.error) return { isError: true, text: r.error.message };
      const text = (r.result.content || []).map((c) => c.text).join("\n");
      return { isError: !!r.result.isError, text };
    },
    waitForNotification(method, timeoutMs = 10000) {
      const already = notifications.find((n) => n.method === method);
      if (already) { notifications.splice(notifications.indexOf(already), 1); return Promise.resolve(already); }
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no ${method} within ${timeoutMs} ms\n${stderr}`)), timeoutMs);
        waiters.push({ method, resolve: (m) => { clearTimeout(t); resolve(m); } });
      });
    },
    stop() { try { child.kill(); } catch {} },
  };
}

export function waitForExit(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const t = setTimeout(() => reject(new Error("process did not exit")), timeoutMs);
    child.on("exit", (code) => { clearTimeout(t); resolve(code); });
  });
}
