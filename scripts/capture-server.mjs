import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const host = process.env.LAPINET_CAPTURE_HOST ?? "127.0.0.1";
const port = Number(process.env.LAPINET_CAPTURE_PORT ?? 1352);
const outputPath =
  process.env.LAPINET_CAPTURE_PATH ??
  path.join(os.tmpdir(), "lapinet-latest-frame.png");
const metadataPath = outputPath + ".json";
const maxBytes = 12 * 1024 * 1024;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,x-lapinet-frame,x-lapinet-width,x-lapinet-height"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(res, status, value) {
  cors(res);
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function latestMetadata() {
  try {
    const [stat, raw] = await Promise.all([
      fs.stat(outputPath),
      fs.readFile(metadataPath, "utf8").catch(() => "{}"),
    ]);
    return {
      available: true,
      path: outputPath,
      bytes: stat.size,
      modifiedMs: stat.mtimeMs,
      ...JSON.parse(raw),
    };
  } catch {
    return {
      available: false,
      path: outputPath,
    };
  }
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${host}:${port}`);

  if (req.method === "GET" && url.pathname === "/") {
    const metadata = await latestMetadata();
    const body = [
      "Lapinet capture receiver",
      "",
      "available: " + metadata.available,
      "frame: " + (metadata.frame ?? "none"),
      "size: " + (metadata.width ?? 0) + "x" + (metadata.height ?? 0),
      "status: /status",
      "latest image: /latest.png",
    ].join("\n");
    cors(res);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    res.end(body);
    return;
  }

  if (req.method === "GET" && url.pathname === "/status") {
    sendJson(res, 200, await latestMetadata());
    return;
  }

  if (req.method === "GET" && url.pathname === "/latest.png") {
    try {
      const data = await fs.readFile(outputPath);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": data.length,
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      sendJson(res, 404, { available: false });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/capture") {
    const chunks = [];
    let bytes = 0;

    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          sendJson(res, 413, { error: "capture too large" });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }

      const data = Buffer.concat(chunks);
      const pngSignature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      if (
        data.length < pngSignature.length ||
        !data.subarray(0, pngSignature.length).equals(pngSignature)
      ) {
        sendJson(res, 415, { error: "capture must be PNG" });
        return;
      }

      const tempPath = outputPath + ".tmp";
      await fs.writeFile(tempPath, data);
      await fs.rename(tempPath, outputPath);

      const metadata = {
        frame: Number(req.headers["x-lapinet-frame"] ?? -1),
        width: Number(req.headers["x-lapinet-width"] ?? 0),
        height: Number(req.headers["x-lapinet-height"] ?? 0),
        capturedAt: new Date().toISOString(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata));

      sendJson(res, 200, {
        ok: true,
        bytes: data.length,
        ...metadata,
      });
    } catch (error) {
      sendJson(res, 500, {
        error: String(error?.message ?? error),
      });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, host, () => {
  process.stdout.write(
    `Lapinet capture receiver listening on http://${host}:${port}\n` +
    `latest frame: ${outputPath}\n`
  );
});
