// Serve the UI gallery on http://127.0.0.1:8766/ and accept its exports.
//
//   node scripts/ui-gallery/serve.mjs
//
// GET  /              the gallery page
// GET  /styles.css    the plugin's live stylesheet (repo root), never a copy
// GET  /…             files under scripts/ui-gallery/
// POST /save?path=…   write the request body to out/… or pulled/… (nowhere else)
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const port = Number(process.env.PORT ?? 8766);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function inside(root, p) {
  const rel = path.relative(root, p);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// The gallery itself, and Claude Design's preview pages (a pull reads the
// project there and saves it here). Nobody else may write, or read cross-origin.
function trusted(origin) {
  return (
    !origin ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ||
    /^https:\/\/[a-z0-9-]+\.claudeusercontent\.com$/.test(origin)
  );
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const origin = req.headers.origin;
  const cors =
    origin && trusted(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Private-Network": "true",
          Vary: "Origin",
        }
      : {};
  if (!trusted(origin)) {
    res.writeHead(403).end("origin not allowed");
    return;
  }
  if (req.method === "POST" && url.pathname === "/save") {
    const target = path.resolve(here, url.searchParams.get("path") ?? "");
    const allowed = [path.join(here, "out"), path.join(here, "pulled")].some((r) =>
      inside(r, target),
    );
    if (!allowed) {
      res.writeHead(403, cors).end("only out/ and pulled/");
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, Buffer.concat(chunks));
      res.writeHead(200, cors).end("ok");
    });
    return;
  }
  if (req.method === "OPTIONS") {
    res
      .writeHead(204, {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "content-type",
      })
      .end();
    return;
  }
  let file =
    url.pathname === "/"
      ? path.join(here, "gallery.html")
      : path.resolve(here, "." + decodeURIComponent(url.pathname));
  if (url.pathname === "/styles.css") file = path.join(repo, "styles.css");
  else if (!inside(here, file)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = path.join(file, "index.html");
    res.writeHead(200, {
      ...cors,
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`UI gallery on http://127.0.0.1:${port}/`));
