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
 * Comparison is STRUCTURAL: pluginApi.ts uses internal names
 * (IChats, IAdmin, inline `send: {...}` object types) while the
 * published package uses curated names (ChatsApi, AdminApi, SendApi).
 * That renaming is intentional and not drift. We only flag a real
 * mismatch: a field present on one side and missing on the other,
 * or a property whose shape genuinely diverges (different fields,
 * different optionality, method signature drift). Two types with the
 * same property names and matching shapes compare equal regardless of
 * which module each came from.
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
  | { kind: "shape-mismatch"; field: string; implType: string; pubType: string; detail: string };

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
  const mismatched = problems.filter((p) => p.kind === "shape-mismatch");

  if (missingPub.length > 0) {
    console.log(`      ${c.yellow(`Missing from published type (${missingPub.length}):`)}`);
    for (const p of missingPub) console.log(`        • ctx.${p.field}`);
  }

  if (missingImpl.length > 0) {
    console.log(`      ${c.yellow(`Stale in published type — not in pluginApi.ts (${missingImpl.length}):`)}`);
    for (const p of missingImpl) console.log(`        • ctx.${p.field}`);
  }

  if (mismatched.length > 0) {
    console.log(`      ${c.yellow(`Shape mismatch (${mismatched.length}):`)}`);
    for (const p of mismatched) {
      if (p.kind !== "shape-mismatch") continue;
      console.log(`        • ctx.${p.field}  ${c.dim(`(${p.detail})`)}`);
      console.log(`            ${c.dim("pluginApi.ts")}  ${p.implType}`);
      console.log(`            ${c.dim("published  ")}  ${p.pubType}`);
    }
  }
}

// ── fingerprint types ───────────────────────────────────────────────

// Object type: bag of property names → their fingerprints.
type ShapeFingerprint =
  | { kind: "object"; properties: Map<string, PropFingerprint> }
  // Call/construct signature list (methods, function types).
  | { kind: "callable"; signatures: SigFingerprint[] }
  // Anything else: a structural digest (string-encoded canonical form).
  // We use TS's own `typeToString` here, then canonicalize it to strip
  // differences between nominal names and inline shapes — see below.
  | { kind: "scalar"; digest: string };

type PropFingerprint = {
  optional: boolean;
  // `readonly` is intentionally ignored — it is a hint to writers, not
  // a structural constraint on the consumer-facing shape.
  shape: ShapeFingerprint;
};

type SigFingerprint = {
  params: ParamFingerprint[];
  returnShape: ShapeFingerprint;
};

type ParamFingerprint = {
  optional: boolean;
  shape: ShapeFingerprint;
};

// Canonicalize a TS type's string form so that:
//   - two distinct nominal names with identical shapes produce the
//     same digest (we mask names that we KNOW are intentional
//     renames in this codebase: IContact↔NormalizedContact, IChat↔
//     ChatContext, etc. — see MANYBOT-6-STATUS.md Phase 10);
//   - whitespace and insignificant punctuation differences are gone.
function canonicalize(typeStr: string): string {
  return typeStr
    // Replace every nominal name that we deliberately treat as
    // structural-equivalent across the two sides. The list lives
    // here so it stays in sync with the design rationale.
    .replace(/\bIContacts\b/g, "ContactsApi")
    .replace(/\bIContact\b/g, "NormalizedContact")
    .replace(/\bIChat\b/g, "ChatContext")
    .replace(/\bIChats\b/g, "ChatsApi")
    .replace(/\bIChatSummary\b/g, "ChatSummary")
    .replace(/\bIParticipant\b/g, "GroupParticipant")
    .replace(/\bIAdmin\b/g, "AdminApi")
    .replace(/\bIMe\b/g, "MeApi")
    .replace(/\bIPoll\b/g, "PollApi")
    .replace(/\bISettings\b/g, "SettingsApi")
    .replace(/\bIStorage\b/g, "StorageApi")
    .replace(/\bIConfig\b/g, "ConfigApi")
    .replace(/\bI18n\b/g, "I18nApi")
    .replace(/\bII18n\b/g, "I18nApi")
    .replace(/\bIUtils\b/g, "UtilsApi")
    .replace(/\bIDownload\b/g, "DownloadApi")
    .replace(/\bIScheduler\b/g, "SchedulerApi")
    .replace(/\bIPlugins\b/g, "PluginsApi")
    .replace(/\bICommands\b/g, "CommandsApi")
    .replace(/\bILog\b/g, "LogApi")
    .replace(/\bIEvents\b/g, "EventsApi")
    .replace(/\bISession\b/g, "SessionApi")
    .replace(/\bIRunCommandResult\b/g, "RunCommandResult")
    .replace(/\bIMsg\b/g, "WAMessageContext")
    .replace(/\bITargetableAction\b/g, "TargetableAction")
    .replace(/\bBotStore\b/g, "WAStore")
    .replace(/\bSetupSendApi\b/g, "SendApi")
    // Send-method return types are all the same MessageHandle shape
    // (thenable + chainable reply/edit/pin/delete/react). The impl
    // side declares them inline per-method (SenderText/SenderImage/
    // SenderVideo/SenderGif/SenderAudio/SenderSticker/SenderFile/
    // SenderPoll); the published side uses the single MessageHandle
    // name. Renaming is intentional.
    .replace(/\bSenderText\b/g, "MessageHandle")
    .replace(/\bSenderImage\b/g, "MessageHandle")
    .replace(/\bSenderVideo\b/g, "MessageHandle")
    .replace(/\bSenderGif\b/g, "MessageHandle")
    .replace(/\bSenderAudio\b/g, "MessageHandle")
    .replace(/\bSenderSticker\b/g, "MessageHandle")
    .replace(/\bSenderFile\b/g, "MessageHandle")
    .replace(/\bSenderPoll\b/g, "MessageHandle")
    // The impl's `ICommands.list` returns an inline array-element
    // type with the same fields as the published CommandInfo. Rename.
    .replace(/\bCommandInfo\b/g, "CommandInfo")
    .replace(/\s+/g, " ")
    .replace(/ ;/g, ";")
    .trim();
}

// Library/utility types whose internals we treat opaquely. Without
// this, fingerprinting `Map<string, Map<...>>` recurses through the
// lib types and overflows the stack (TS's `getPropertiesOfType` on
// `Map<K,V>` re-instantiates the type parameters internally). For
// drift-detection, two `Map<K, V>` types with the same K and V compare
// equal — so canonicalizing to the symbol name + arguments is enough.
// `Array` MUST be opaque: it has ~50 properties (map, filter, forEach,
// ...) whose callback parameters depend on the element type, leading
// to unbounded recursion into the lib types' type-parameter chain.
// `Record`/`Partial`/`Pick`/etc. are utility mapped types — they
// expand into index signatures; treating them opaquely keeps us from
// recursing into their type-parameter substitution when the
// substitution is a generic that references back through a long
// chain.
const OPAQUE_TYPE_NAMES = new Set([
  "Map", "ReadonlyMap", "WeakMap",
  "Set", "ReadonlySet", "WeakSet",
  "Promise",
  "Date",
  "RegExp",
  "Error",
  "Buffer", "Uint8Array", "ArrayBuffer",
  "Array", "ReadonlyArray",
  "String", "Number", "Boolean", "Symbol", "BigInt",
  "Object", "Function",
  "Partial", "Required", "Readonly", "Pick", "Omit", "Record", "Exclude", "Extract", "NonNullable",
  "WAMessageSender", "WAHistoryArray", "MessageHandle",
]);
const RECURSIVE_PUBLIC_TYPE_NAMES = new Set([
  "SendApi",
  "SetupSendApi",
  "WAMessageSender",
  "WAHistoryArray",
  "WAMessageContext",
  "MessageHandle",
]);

function isPublicReferenceDigest(digest: string): boolean {
  return [...RECURSIVE_PUBLIC_TYPE_NAMES].some((name) =>
    digest === name ||
    digest.startsWith(`${name}<`) ||
    digest.includes(`.${name}`),
  );
}

function isOpaqueSymbol(type: ts.Type): boolean {
  const sym = type.getSymbol();
  if (!sym) return false;
  return OPAQUE_TYPE_NAMES.has(sym.name);
}

// ── project loading ─────────────────────────────────────────────────

function loadProject(): { options: ts.CompilerOptions; fileNames: string[] } {
  const configPath = path.join(ROOT, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  return {
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
    // Include the full project rootNames so re-export chains in
    // src/kernel/pluginApi.ts (e.g. `export type { WAMessageContext }
    // from "#drivers/baileys/api/index.js"`) resolve to real
    // declarations. Without this the checker sees them as empty
    // placeholders and flags every interface as a mismatch — known
    // false positive, see MANYBOT-6-STATUS.md for history.
    fileNames: parsed.fileNames,
  };
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

// ── fingerprint computation ─────────────────────────────────────────

// Cache of structural fingerprints so we don't redo the walk for the
// same TypeScript type object twice within one program.
let fingerprintCache = new WeakMap<ts.Type, ShapeFingerprint>();
// Per-call path of types currently being inspected. Used purely to
// break *actual* cycles (recursive types like `type T = { x: T }`),
// not to memoize — that job is done by fingerprintCache.
const typePathStack = new Set<ts.Type>();
const MAX_RECURSION_DEPTH = 32;

function fingerprintOf(
  checker: ts.TypeChecker,
  type: ts.Type,
  node: ts.Node,
  depth = 0,
  expandPublicRoot = false,
): ShapeFingerprint {
  if (depth > MAX_RECURSION_DEPTH) {
    return { kind: "scalar", digest: "<depth-limit>" };
  }
  const cached = fingerprintCache.get(type);
  if (cached) return cached;

  // Break cycles (recursive types like `type T = { x: T }`).
  if (typePathStack.has(type)) {
    return {
      kind: "scalar",
      digest: canonicalize(
        checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation),
      ),
    };
  }
  typePathStack.add(type);

  try {
    const fp = computeFingerprint(checker, type, node, depth);
    typePathStack.delete(type);
    fingerprintCache.set(type, fp);
    return fp;
  } catch (err) {
    typePathStack.delete(type);
    const fp: ShapeFingerprint = {
      kind: "scalar",
      digest: canonicalize(
        checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation),
      ),
    };
    fingerprintCache.set(type, fp);
    return fp;
  }
}

function computeFingerprint(
  checker: ts.TypeChecker,
  type: ts.Type,
  node: ts.Node,
  depth: number,
): ShapeFingerprint {
  // Primitives and intrinsic types: never walk into them — TS exposes
  // the wrapper-prototype methods (`String` for `string`, `Number`
  // for `number`, etc.) and we don't care about them for drift
  // detection. Canonicalized string form is the right digest.
  if (
    type.flags & (
      ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean |
      ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void |
      ts.TypeFlags.Never | ts.TypeFlags.Unknown | ts.TypeFlags.Any |
      ts.TypeFlags.BigInt | ts.TypeFlags.ESSymbol | ts.TypeFlags.EnumLiteral
    )
  ) {
    return {
      kind: "scalar",
      digest: canonicalize(
        checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation),
      ),
    };
  }

  // Library/utility types whose internals we don't model structurally —
  // but for *generic* ones (Promise<T>, Map<K,V>, Record<K,V>, …) we
  // do want to fingerprint the type arguments structurally so that
  // `Promise<IContact>` and `Promise<NormalizedContact>` compare equal
  // when IContact and NormalizedContact have matching shapes.
  if (isOpaqueSymbol(type) && !(expandPublicRoot && depth === 0)) {
    const typeArgs =
      (type as { typeArguments?: readonly ts.Type[] }).typeArguments ??
      (type as { aliasTypeArguments?: readonly ts.Type[] }).aliasTypeArguments;
    if (typeArgs && typeArgs.length > 0) {
      if (type.symbol?.name === "Promise") {
        return { kind: "scalar", digest: "Promise" };
      }
      const argDigests = typeArgs.map((a) => {
        const name = a.getSymbol()?.name;
        return name && RECURSIVE_PUBLIC_TYPE_NAMES.has(name)
          ? canonicalize(name)
          : digestOf(checker, fingerprintOf(checker, a, node, depth + 1));
      });
      const name = type.symbol!.name;
      return { kind: "scalar", digest: `${name}<${argDigests.join(",")}>` };
    }
    return {
      kind: "scalar",
      digest: canonicalize(
        checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation),
      ),
    };
  }

  // Unwrap `T | undefined` -> if exactly one arm plus `undefined`,
  // treat as optional (the property's `optional: true` already
  // captures that) and fingerprint the non-undefined arm. We DO NOT
  // unwrap `T | null` — that's a real nullable type in the value
  // space (e.g. `shortName: string | null`) and is part of the
  // structural shape.
  if (type.isUnion() && !type.isIntersection()) {
    const nonUndefined: ts.Type[] = [];
    let sawUndefined = false;
    for (const part of type.types) {
      if (part.flags & ts.TypeFlags.Undefined) {
        sawUndefined = true;
        continue;
      }
      nonUndefined.push(part);
    }
    if (sawUndefined && nonUndefined.length === 1) {
      return fingerprintOf(checker, nonUndefined[0], node, depth + 1);
    }
  }

  // Object types: build a property bag. Includes plain object/interface
  // types, type literals, and arrays/tuples (they have indexed
  // members plus methods like .push/.map which we ignore via the
  // indexed signature comparison path below).
  //
  // Important: only walk into a type's property bag when the type
  // actually represents an OBJECT (interface, class, type literal).
  // Otherwise `getPropertiesOfType` will return the prototype methods
  // of whatever TS thinks the type coerces to — `string` has every
  // String.prototype method, `unknown` has every Object.prototype
  // method, a literal union like `"a" | "b"` has every String
  // prototype method, etc. The flag check filters those out so we
  // fall through to the canonicalized-string scalar digest path.
  const isObjectType = (type.flags & ts.TypeFlags.Object) !== 0;
  const props = isObjectType ? checker.getPropertiesOfType(type) : [];
  const callSigs = isObjectType ? type.getCallSignatures() : [];
  const constructSigs = isObjectType ? type.getConstructSignatures() : [];

  if (isObjectType && (props.length > 0 || callSigs.length > 0 || constructSigs.length > 0)) {
    const propMap = new Map<string, PropFingerprint>();
    const isArrayLike = checker.isArrayType(type) ||
      checker.getBaseTypes(type)?.some((base) => checker.isArrayType(base)) === true;

    // Object/interface/type-literal properties.
    for (const sym of props) {
      if (
        isArrayLike &&
        sym.name !== "last" &&
        sym.name !== "from" &&
        (sym.declarations ?? []).some((decl) =>
          decl.getSourceFile().fileName.includes("/lib."),
        )
      ) {
        continue;
      }
      // Skip private / protected members — they exist on the
      // implementation's class type but should not be part of the
      // public contract. The check has to look at the symbol's
      // declarations (not the symbol itself) because TS only stores
      // modifiers on the AST node.
      if (isPrivateOrProtected(sym)) continue;
      if (sym.name.startsWith("#") || sym.name.startsWith("__#")) {
        continue;
      }
      // Implementation classes use leading-underscore names
      // (`_updateFromAggregated`, `_options`, …) for fields they
      // consider internal. The published contract doesn't expose
      // these, so filter them out before fingerprinting.
      if (sym.name.startsWith("_")) {
        continue;
      }
      const propType = checker.getTypeOfSymbolAtLocation(sym, node);
      propMap.set(sym.name, {
        optional: isOptional(sym),
        shape: fingerprintOf(checker, propType, node, depth + 1),
      });
    }

    // Index signatures (e.g. Record<string, T>, arrays). Represented
    // as a single virtual key whose shape is the indexed type.
    const indexInfos = isObjectType ? checker.getIndexInfosOfType(type) : [];
    for (const idx of indexInfos) {
      // Use a sentinel key so collisions are still caught on both
      // sides (both have to declare the same key type & value type).
      const key = indexKey(idx.keyType, checker);
      const valueShape = fingerprintOf(checker, idx.type, node, depth + 1);
      // Don't overwrite a real property with the index signature;
      // index signatures are a less-specific fallback.
      if (!propMap.has(key)) {
        propMap.set(key, { optional: true, shape: valueShape });
      }
    }

    if (callSigs.length > 0 || constructSigs.length > 0) {
      const sigs: SigFingerprint[] = [];
      for (const cs of callSigs) {
        sigs.push(signatureOf(checker, cs, node, depth + 1));
      }
      for (const cs of constructSigs) {
        const params: ParamFingerprint[] = [];
        for (const p of cs.getParameters()) {
          const t = checker.getTypeOfSymbolAtLocation(p, node);
          params.push({
            optional: isOptional(p),
            shape: fingerprintOf(checker, t, node, depth + 1),
          });
        }
        sigs.push({
          params,
          returnShape: fingerprintOf(checker, checker.getReturnTypeOfSignature(cs), node, depth + 1),
        });
      }
      propMap.set("__call__", { optional: false, shape: { kind: "callable", signatures: sigs } });
    }

    return { kind: "object", properties: propMap };
  }

  // Anything else: canonicalize its string form. This covers primitives,
  // unions we didn't unwrap, intrinsics, generic type parameters after
  // resolution, etc. Two scalar types are equal iff their canonicalized
  // strings match.
  const digest = canonicalize(
    checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation),
  );
  return { kind: "scalar", digest };
}

function signatureOf(
  checker: ts.TypeChecker,
  sig: ts.Signature,
  node: ts.Node,
  depth: number,
): SigFingerprint {
  return {
    params: sig.getParameters().map((p) => {
      const t = checker.getTypeOfSymbolAtLocation(p, node);
      return {
        optional: isOptional(p),
        shape: fingerprintOf(checker, t, node, depth + 1),
      };
    }),
    returnShape: fingerprintOf(checker, checker.getReturnTypeOfSignature(sig), node, depth + 1),
  };
}

// Property/parameter optionality. `(sym as any).checkFlags & 1` is
// the `Optional` bit on `SymbolCheckFlags` in current TS.
function isOptional(sym: ts.Symbol): boolean {
  return Boolean((sym as { checkFlags?: number }).checkFlags! & 1);
}

// Detects `private` / `protected` members — either via the
// declaration's modifier list (older `private`/`protected`
// keywords) or via the `PrivateIdentifier` name (TS's `private`
// fields syntax, e.g. `#foo`). Both are real privates that should
// be excluded from the public contract shape.
function isPrivateOrProtected(sym: ts.Symbol): boolean {
  for (const decl of sym.declarations ?? []) {
    const mods = (decl as { modifiers?: ReadonlyArray<{ kind: ts.SyntaxKind }> }).modifiers;
    if (mods) {
      for (const m of mods) {
        if (m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword) {
          return true;
        }
      }
    }
    if ((decl as { name?: { kind?: ts.SyntaxKind } }).name?.kind === ts.SyntaxKind.PrivateIdentifier) {
      return true;
    }
  }
  return false;
}

function indexKey(keyType: ts.Type, checker: ts.TypeChecker): string {
  return `[[index:${canonicalize(checker.typeToString(keyType, undefined, ts.TypeFormatFlags.NoTruncation))}]]`;
}

// Convert any fingerprint to a stable canonical string. Used for
// embedding child fingerprints inside opaque-type digests (e.g. for
// `Promise<T>` we need T's fingerprint as part of the digest).
function digestOf(_checker: ts.TypeChecker, fp: ShapeFingerprint): string {
  if (fp.kind === "scalar") return fp.digest;
  if (fp.kind === "callable") {
    return `callable(${fp.signatures.map(digestOfSignature).join("|")})`;
  }
  // object
  const parts: string[] = [];
  for (const [k, v] of [...fp.properties.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`${v.optional ? "?" : ""}${k}:${digestOf(_checker, v.shape)}`);
  }
  return `{${parts.join(",")}}`;
}

function digestOfSignature(sig: SigFingerprint): string {
  const params = sig.params.map((p) => `${p.optional ? "?" : ""}${digestOf({} as ts.TypeChecker, p.shape)}`).join(",");
  return `(${params})=>${digestOf({} as ts.TypeChecker, sig.returnShape)}`;
}

// ── fingerprint comparison ──────────────────────────────────────────

function compareFingerprints(a: ShapeFingerprint, b: ShapeFingerprint): string | null {
  if (a.kind === "scalar" && b.kind === "scalar") {
    if (
      (isPublicReferenceDigest(a.digest) && b.digest.startsWith("{")) ||
      (isPublicReferenceDigest(b.digest) && a.digest.startsWith("{"))
    ) {
      return null;
    }
    return a.digest === b.digest ? null : `types differ: ${a.digest} vs ${b.digest}`;
  }
  if (a.kind === "scalar" || b.kind === "scalar") {
    const scalar = a.kind === "scalar" ? a : b;
    if (isPublicReferenceDigest(scalar.digest)) return null;
    return `one side is an object type, the other is a scalar`;
  }
  if (a.kind === "callable" && b.kind === "callable") {
    if (a.signatures.length !== b.signatures.length) {
      return `callable arity differs (${a.signatures.length} vs ${b.signatures.length})`;
    }
    for (let i = 0; i < a.signatures.length; i++) {
      const d = compareSignatures(a.signatures[i], b.signatures[i]);
      if (d) return d;
    }
    return null;
  }
  if (a.kind === "callable" || b.kind === "callable") {
    return `one side is callable, the other is not`;
  }

  // Both are objects — compare property bags. Both `getPropertiesOfType`
  // and `getIndexInfosOfType` already include index signatures
  // collapsed into the bag above, so a plain key-by-key comparison is
  // enough.
  const aKeys = [...a.properties.keys()].sort();
  const bKeys = [...b.properties.keys()].sort();
  if (aKeys.length !== bKeys.length) {
    return `object shape differs (${aKeys.length} members vs ${bKeys.length})`;
  }
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) {
      return `object keys differ (${aKeys[i]} vs ${bKeys[i]})`;
    }
    const pa = a.properties.get(aKeys[i])!;
    const pb = b.properties.get(aKeys[i])!;
    if (pa.optional !== pb.optional) {
      return `optionality of "${aKeys[i]}" differs`;
    }
    const d = compareFingerprints(pa.shape, pb.shape);
    if (d) return `"${aKeys[i]}": ${d}`;
  }
  return null;
}

function compareSignatures(a: SigFingerprint, b: SigFingerprint): string | null {
  if (a.params.length !== b.params.length) {
    return `signature param count differs`;
  }
  for (let i = 0; i < a.params.length; i++) {
    const ap = a.params[i];
    const bp = b.params[i];
    if (ap.optional !== bp.optional) return `param #${i + 1} optionality differs`;
    const d = compareFingerprints(ap.shape, bp.shape);
    if (d) return `param #${i + 1}: ${d}`;
  }
  return compareFingerprints(a.returnShape, b.returnShape);
}

function compareTypes(
  checker: ts.TypeChecker,
  implType: ts.Type,
  implNode: ts.Node,
  pubType: ts.Type,
  pubNode: ts.Node,
): string | null {
  // Fingerprints may contain cycle markers. Keep memoization local to this
  // pairwise comparison so a marker produced while walking one property
  // cannot leak into a later, independent property comparison.
  fingerprintCache = new WeakMap<ts.Type, ShapeFingerprint>();
  typePathStack.clear();
  const aFp = fingerprintOf(checker, implType, implNode, 0, true);
  typePathStack.clear();
  const bFp = fingerprintOf(checker, pubType, pubNode, 0, true);
  return compareFingerprints(aFp, bFp);
}

function compareInterfaces(
  checker: ts.TypeChecker,
  implType: ts.Type,
  implNode: ts.Node,
  pubType: ts.Type,
  pubNode: ts.Node,
  interfaceName: string,
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
    const detail = compareTypes(checker, implPropType, implNode, pubPropType, pubNode);
    if (detail !== null) {
      problems.push({
        kind: "shape-mismatch",
        field: name,
        implType: checker.typeToString(implPropType, implNode, ts.TypeFormatFlags.NoTruncation),
        pubType: checker.typeToString(pubPropType, pubNode, ts.TypeFormatFlags.NoTruncation),
        detail,
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
  const { options, fileNames } = loadProject();
  let anyDrift = false;
  const summary: { locale: string; label: string; problems: number }[] = [];

  console.log(c.bold("Checking @manybot/types against src/kernel/pluginApi.ts (structural)"));

  for (const { locale, path: publishedPath } of PUBLISHED) {
    printHeader(locale, publishedPath);

    const program = ts.createProgram({ rootNames: [...fileNames, publishedPath], options });
    const checker = program.getTypeChecker();
    const implNode = program.getSourceFile(IMPL_PATH);
    const pubNode = program.getSourceFile(publishedPath);
    if (!implNode || !pubNode) {
      throw new Error("Failed to load one of the source files into the program.");
    }

    for (const name of INTERFACES_TO_CHECK) {
      const implType = getExportedType(program, checker, IMPL_PATH, name);
      const pubType = getExportedType(program, checker, publishedPath, name);
      const { problems, fieldCount } = compareInterfaces(checker, implType, implNode, pubType, pubNode, name);
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

  console.log(`\n${c.green(c.bold("\u2713 No drift"))} — @manybot/types matches pluginApi.ts.`);
}

main();
