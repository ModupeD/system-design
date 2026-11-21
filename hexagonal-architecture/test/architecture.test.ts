// ARCHITECTURE TEST (a "fitness function").
// It enforces the dependency rule automatically by reading import statements:
//
//   domain       → may import: domain                       (no node:, no npm)
//   application  → may import: domain, application         (no node:, no npm)
//   driving      → may import: domain, application, adapters/shared, node:/npm
//   driven       → may import: domain, application, adapters/shared, node:/npm
//
// Adapters never import each other across sides, and nothing except the
// composition root and the entry points knows about concrete adapters.
// Try it: add `import { readFile } from "node:fs"` to src/domain/Order.ts and run `npm test`.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

const rules: { layer: string; mayImport: string[]; mayUsePackages: boolean }[] = [
  { layer: "domain", mayImport: ["domain"], mayUsePackages: false },
  { layer: "application", mayImport: ["domain", "application"], mayUsePackages: false },
  { layer: "adapters/driving", mayImport: ["domain", "application", "adapters/driving", "adapters/shared"], mayUsePackages: true },
  { layer: "adapters/driven", mayImport: ["domain", "application", "adapters/driven", "adapters/shared"], mayUsePackages: true },
  { layer: "adapters/shared", mayImport: ["adapters/shared"], mayUsePackages: true },
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

// Matches `from "x"`, `import "x"` and `import("x")`.
const IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

describe("Architecture: dependencies point inward", () => {
  for (const { layer, mayImport, mayUsePackages } of rules) {
    const layerDir = join(srcDir, layer);
    for (const file of tsFiles(layerDir)) {
      it(`${relative(srcDir, file)} respects the ${layer} rules`, () => {
        for (const [, spec] of readFileSync(file, "utf8").matchAll(IMPORT)) {
          if (!spec!.startsWith(".")) {
            assert.ok(mayUsePackages, `imports "${spec}": ${layer} must not depend on Node.js or npm packages`);
            continue;
          }
          const target = relative(srcDir, resolve(dirname(file), spec!)).split(sep).join("/");
          assert.ok(
            mayImport.some((allowed) => target.startsWith(`${allowed}/`)),
            `imports "${spec}" (${target}); ${layer} may only import from: ${mayImport.join(", ")}`,
          );
        }
      });
    }
  }
});
