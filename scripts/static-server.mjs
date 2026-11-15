import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 1351);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wgsl": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const file = resolve(root, "." + pathname);
    if (!file.startsWith(root + sep)) {
      res.writeHead(403, {"cache-control":"no-store"});
      res.end("Forbidden");
      return;
    }
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error("not file");
    res.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, {
      "content-type":"text/plain; charset=utf-8",
      "cache-control":"no-store",
    });
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Lapinet static server http://127.0.0.1:${port}/`);
});
