import { createRequire } from "module";
import path from "path";
import { readFileSync, existsSync } from "fs";

/**
 * Resolves the installed @whiskeysockets/baileys version for telemetry
 * (instance.backend_version). Walks up from the resolved module path
 * instead of importing "@whiskeysockets/baileys/package.json" directly,
 * since that subpath isn't guaranteed to be in the package's "exports" map.
 */
export function resolveBaileysVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    let dir = path.dirname(require.resolve("@whiskeysockets/baileys"));
    for (let i = 0; i < 6; i++) {
      const pkgPath = path.join(dir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
        if (pkg.name === "@whiskeysockets/baileys") return pkg.version ?? "unknown";
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through to "unknown"
  }
  return "unknown";
}
