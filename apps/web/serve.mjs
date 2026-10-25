// A tiny static server that behaves like Cloudflare Pages for this site: clean URLs (/privacy serves privacy.html)
// and the 200 rewrites from public/_redirects. For local preview and the end-to-end tests.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const dist = resolve(import.meta.dirname, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

function rules() {
  const file = join(dist, "_redirects");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [from, to, status] = l.split(/\s+/);
      const pattern = new RegExp(`^${from.replace(/:[a-z]+/gi, "([^/]+)")}/?$`);
      return { pattern, to, status: Number(status) };
    });
}

export function startServer(port = 4173) {
  const table = rules();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const candidates = [path === "/" ? "index.html" : path.slice(1), `${path.slice(1)}.html`];
    let file = candidates.map((c) => join(dist, c)).find((c) => c.startsWith(dist) && existsSync(c) && statSync(c).isFile());
    if (!file) {
      const rule = table.find((r) => r.status === 200 && r.pattern.test(path));
      if (rule) file = join(dist, rule.to.slice(1));
    }
    if (!file || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("לא נמצא");
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/html; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${port}`, close: () => server.close() })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startServer(Number(process.env.PORT) || 4173);
  console.log(`preview at ${url}`);
}
