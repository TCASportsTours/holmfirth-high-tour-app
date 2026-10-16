// Local preview: serves public/ and runs the tour function with an in-memory store.
// Usage: STAFF_PASSWORD=test node dev/dev-server.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const mem = new Map();
globalThis.__TOUR_TEST_STORE__ = { get: async (k) => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); }, delete: async (k) => { mem.delete(k); },
  list: async ({ prefix = "" } = {}) => ({ blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) };
const { default: handler } = await import("../netlify/functions/tour.mjs");

const root = path.resolve(new URL("../public", import.meta.url).pathname);
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };
const port = Number(process.argv[2] || 8787);

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  if (u.pathname === "/.netlify/functions/tour") {
    const body = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : await new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
    const out = await handler(new Request(u, { method: req.method, headers: req.headers, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(await out.text()); return;
  }
  let f = path.join(root, decodeURIComponent(u.pathname));
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}  (STAFF_PASSWORD ${process.env.STAFF_PASSWORD ? "set" : "NOT set"})`));
