/**
 * scripts/check-types-drift.ts
 *
 * Structural drift check between the real `ctx` contract
 * (src/kernel/pluginApi.ts — PluginContext / SetupContext) and the
 * hand-maintained public package (packages/types/{en,pt}/index.d.ts).
 *
 * This does NOT generate anything. `@manybot/types` stays hand-written
 * (curated interface names, real Baileys types, en+pt JSDoc, @examples —
 * see MANYBOT-6-STATUS.md for why a full generator was scrapped). This
 * script only answers: "did someone add/remove/change a ctx field in
 * pluginApi.ts without updating the published types to match?"
 *
 * Comparison is STRUCTURAL, not nominal: pluginApi.ts uses internal
 * names (IChats, IAdmin, inline `send: {...}` object types) while the
 * published package uses curated names (ChatsApi, AdminApi, SendApi).
 * That renaming is intentional and not drift. We only flag a real
 * mismatch: a field present on one side and missing (or a genuinely
 * incompatible type) on the other.
 *
 * Usage:
 *   npx tsx scripts/check-types-drift.ts
 * Exit code 1 on drift (wire into `npm run check` / CI).
 */

import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPL_PATH = path.join(ROOT, "src/kernel/pluginApi.ts");

// locale packages to check against the same impl. `en` is the primary
// source; `pt` is checked too since it must carry the exact same shape
// (translation is JSDoc-only, never a structural difference).
const PUBLISHED = [
  { locale: "en", path: path.join(ROOT, "packages/types/en/index.d.ts") },
  { locale: "pt", path: path.join(ROOT, "packages/types/pt/index.d.ts") },
];

const INTERFACES_TO_CHECK = ["PluginContext", "SetupContext"] as const;

// ── output helpers ──────────────────────────────────────────────────
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (supportsColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (supportsColor ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (supportsColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (supportsColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (supportsColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (supportsColor ? `\x1b[36m${s}\x1b[0m` : s),
};

type Problem =
  | { kind: "missing-in-published"; field: string }
  | { kind: "missing-in-impl"; field: string }
  | { kind: "type-mismatch"; field: string; implType: string; pubType: string };

function printHeader(locale: string, publishedPath: string) {
  console.log(`\n${c.bold(c.cyan(`▶ ${locale}`))} ${c.dim(path.relative(ROOT, publishedPath))}`);
}

function printResult(label: string, fieldCount: number, problems: Problem[]) {
  if (problems.length === 0) {
    console.log(`  ${c.green("✓")} ${c.bold(label)} ${c.dim(`(${fieldCount} fields, in sync)`)}`);
    return;
  }

  console.log(`  ${c.red("✗")} ${c.bold(label)} ${c.red(`— ${problems.length} issue(s)`)}`);

  const missingPub = problems.filter((p) => p.kind === "missing-in-published");
  const missingImpl = problems.filter((p) => p.kind === "missing-in-impl");
  const mismatched = problems.filter((p) => p.kind === "type-mismatch");

  if (missingPub.length > 0) {
    console.log(`      ${c.yellow(`Missing from published type (${missingPub.length}):`)}`);
    for (const p of missingPub) console.log(`        • ctx.${p.field}`);
  }

  if (missingImpl.length > 0) {
    console.log(`      ${c.yellow(`Stale in published type — not in pluginApi.ts (${missingImpl.length}):`)}`);
    for (const p of missingImpl) console.log(`        • ctx.${p.field}`);
  }

  if (mismatched.length > 0) {
    console.log(`      ${c.yellow(`Type mismatch (${mismatched.length}):`)}`);
    for (const p of mismatched) {
      if (p.kind !== "type-mismatch") continue;
      console.log(`        • ctx.${p.field}`);
      console.log(`            ${c.dim("pluginApi.ts")}  ${p.implType}`);
      console.log(`            ${c.dim("published  ")}  ${p.pubType}`);
    }
  }
}

// ── type comparison ─────────────────────────────────────────────────
function loadCompilerOptions(): ts.CompilerOptions {
  const configPath = path.join(ROOT, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  return { ...parsed.options, noEmit: true, skipLibCheck: true };
}

function getExportedType(
  program: ts.Program,
  checker: ts.TypeChecker,
  filePath: string,
  exportName: string,
): ts.Type {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`Could not load "${filePath}" into the program (check the path).`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(`"${filePath}" has no module symbol — is it missing an export?`);
  }
  const exportSymbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === exportName);
  if (!exportSymbol) {
    throw new Error(`"${filePath}" does not export "${exportName}".`);
  }
  return checker.getDeclaredTypeOfSymbol(exportSymbol);
}

function compareInterfaces(
  checker: ts.TypeChecker,
  implType: ts.Type,
  implNode: ts.Node,
  pubType: ts.Type,
  pubNode: ts.Node,
): { problems: Problem[]; fieldCount: number } {
  const problems: Problem[] = [];
  const implProps = new Map(checker.getPropertiesOfType(implType).map((s) => [s.name, s]));
  const pubProps = new Map(checker.getPropertiesOfType(pubType).map((s) => [s.name, s]));

  for (const [name, implSym] of implProps) {
    const pubSym = pubProps.get(name);
    if (!pubSym) {
      problems.push({ kind: "missing-in-published", field: name });
      continue;
    }
    const implPropType = checker.getTypeOfSymbolAtLocation(implSym, implNode);
    const pubPropType = checker.getTypeOfSymbolAtLocation(pubSym, pubNode);
    const forward = checker.isTypeAssignableTo(implPropType, pubPropType);
    const backward = checker.isTypeAssignableTo(pubPropType, implPropType);
    if (!forward || !backward) {
      problems.push({
        kind: "type-mismatch",
        field: name,
        implType: checker.typeToString(implPropType, implNode, ts.TypeFormatFlags.NoTruncation),
        pubType: checker.typeToString(pubPropType, pubNode, ts.TypeFormatFlags.NoTruncation),
      });
    }
  }

  for (const name of pubProps.keys()) {
    if (!implProps.has(name)) {
      problems.push({ kind: "missing-in-impl", field: name });
    }
  }

  return { problems, fieldCount: implProps.size };
}

function main() {
  const options = loadCompilerOptions();
  let anyDrift = false;
  const summary: { locale: string; label: string; problems: number }[] = [];

  console.log(c.bold("Checking @manybot/types against src/kernel/pluginApi.ts"));

  for (const { locale, path: publishedPath } of PUBLISHED) {
    printHeader(locale, publishedPath);

    const program = ts.createProgram({ rootNames: [IMPL_PATH, publishedPath], options });
    const checker = program.getTypeChecker();
    const implNode = program.getSourceFile(IMPL_PATH);
    const pubNode = program.getSourceFile(publishedPath);
    if (!implNode || !pubNode) {
      throw new Error("Failed to load one of the source files into the program.");
    }

    for (const name of INTERFACES_TO_CHECK) {
      const implType = getExportedType(program, checker, IMPL_PATH, name);
      const pubType = getExportedType(program, checker, publishedPath, name);
      const { problems, fieldCount } = compareInterfaces(checker, implType, implNode, pubType, pubNode);
      printResult(name, fieldCount, problems);
      summary.push({ locale, label: name, problems: problems.length });
      if (problems.length > 0) anyDrift = true;
    }
  }

  console.log(`\n${c.bold("Summary")}`);
  for (const s of summary) {
    const status = s.problems === 0 ? c.green("ok") : c.red(`${s.problems} issue(s)`);
    console.log(`  ${s.locale.padEnd(3)} ${s.label.padEnd(14)} ${status}`);
  }

  if (anyDrift) {
    console.error(
      `\n${c.red(c.bold("DRIFT DETECTED"))} — @manybot/types is out of sync with src/kernel/pluginApi.ts.\n` +
        "Update packages/types/en/index.d.ts and packages/types/pt/index.d.ts by hand to match,\n" +
        "then bump the package version (see packages/types/README.md \u2192 Versioning).",
    );
    process.exit(1);
  }

  console.log(`\n${c.green(c.bold("✓ No drift"))} — @manybot/types matches pluginApi.ts.`);
}

main();

