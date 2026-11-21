// ─────────────────────────────────────────────────────────────────────────────
// DEVELOPMENT-ONLY ROUTES used by the Architecture Explorer page.
//   GET /dev/config           which adapter is plugged into each output port
//   GET /dev/traces/:id       the recorded port calls of one traced request
//   GET /dev/imports          the real import graph of src/ (source-code dependencies)
//   GET /dev/source?file=...  a file from src/, so the explorer shows real code
//
// Only mounted when dev tools are enabled (never with NODE_ENV=production).
// Read-only, and limited to files inside src/ with source-code extensions.
// ─────────────────────────────────────────────────────────────────────────────

import { readdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevTracer } from "../../shared/devTracing.ts";

export interface DevOptions {
  tracer: DevTracer;
  /** Port name → name of the concrete adapter plugged into it. */
  adapters: Readonly<Record<string, string>>;
}

const SRC_DIR = fileURLToPath(new URL("../../../", import.meta.url));
const PROJECT_DIR = dirname(SRC_DIR);
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".html", ".css"]);
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

export async function handleDevRoute(req: IncomingMessage, res: ServerResponse, url: URL, dev: DevOptions): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Dev routes are read-only" });

  if (url.pathname === "/dev/config") return sendJson(res, 200, { tracing: true, adapters: dev.adapters });

  const traceMatch = url.pathname.match(/^\/dev\/traces\/([^/]+)$/);
  if (traceMatch) {
    const trace = dev.tracer.get(traceMatch[1]!);
    return trace ? sendJson(res, 200, trace) : sendJson(res, 404, { error: "Trace not found (only the last 50 are kept)" });
  }

  if (url.pathname === "/dev/imports") return sendJson(res, 200, await importGraph());

  if (url.pathname === "/dev/source") {
    const file = resolveSourceFile(url.searchParams.get("file"));
    if (file) {
      try {
        const text = await readFile(file, "utf8");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        return void res.end(text);
      } catch {
        // fall through to 404
      }
    }
    return sendJson(res, 404, { error: "Unknown source file" });
  }

  return sendJson(res, 404, { error: "Unknown dev route" });
}

function resolveSourceFile(param: string | null): string | undefined {
  if (!param) return undefined;
  const absolute = normalize(resolve(PROJECT_DIR, param));
  if (!absolute.startsWith(SRC_DIR) || !SOURCE_EXTENSIONS.has(extname(absolute))) return undefined;
  return absolute;
}

/** Every relative import between .ts files in src/, as project-relative paths. */
async function importGraph(): Promise<{ files: string[]; imports: { from: string; to: string }[] }> {
  const files = await tsFiles(SRC_DIR);
  const imports: { from: string; to: string }[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const [, spec] of source.matchAll(IMPORT)) {
      if (spec!.startsWith(".")) imports.push({ from: toProjectPath(file), to: toProjectPath(resolve(dirname(file), spec!)) });
    }
  }
  return { files: files.map(toProjectPath), imports };
}

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? tsFiles(join(dir, e.name)) : Promise.resolve(e.name.endsWith(".ts") ? [join(dir, e.name)] : []))),
  );
  return nested.flat();
}

function toProjectPath(absolute: string): string {
  return relative(PROJECT_DIR, absolute).split(sep).join("/");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
