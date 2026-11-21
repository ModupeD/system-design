// DRIVING ADAPTER (web UI), server side: serves the browser files in ./public.
// The page itself is a client of the JSON API, exactly like curl or the CLI
// is a client of the use cases. No business logic is served from here.

import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serves a file from ./public if one matches. Returns false so the caller can try API routes. */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  let relativePath: string;
  try {
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return false;
  }

  const filePath = normalize(join(PUBLIC_DIR, relativePath));
  const contentType = CONTENT_TYPES[extname(filePath)];
  if (!filePath.startsWith(PUBLIC_DIR) || !contentType) return false;

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}
