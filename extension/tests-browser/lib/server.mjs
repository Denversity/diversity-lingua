import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
/** Petit serveur statique (origine http réelle : pushState, Navigation API et stockage se comportent comme en production). */
export function serve(dir) {
  const srv = createServer((req, res) => {
    const p = resolve(dir, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
    try { const b = readFileSync(p); res.writeHead(200, { "content-type": extname(p) === ".html" ? "text/html; charset=utf-8" : "text/plain" }); res.end(b); }
    catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}
