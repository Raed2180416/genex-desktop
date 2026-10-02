/**
 * The harness's copy of the host contract: `src/harness-seed/types/host-api.d.ts`, generated from
 * `src/shared/harness-api.ts` (what the harness may call) and the dispatch half of
 * `src/shared/protocol.ts` (what the host hands the harness to do).
 *
 * The seed is copied into the in-app agent's workspace and type-checked there on its own, so it
 * cannot import `src/shared`. This script walks the contract's types — `HarnessHostApi`,
 * `DispatchAction` and every interface or alias they reach through `src/shared` — and writes them into one self-contained
 * declaration file, in dependency-first order, each with its doc comment. It also writes the one
 * runtime value the seed shares with the host, the `HostMethod` names, into `loop/host-methods.ts`.
 * `scripts/build.mjs` writes both fresh into the seed it ships; `tests/conformance/harness-types.test.ts`
 * fails when a committed copy is out of date. `node scripts/gen-harness-types.ts` rewrites them;
 * `--check` only compares.
 */
import ts from "@typescript/typescript6";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONTRACT = "src/shared/harness-api.ts";
/** Where the file sits inside the seed (and so inside the agent's workspace). */
export const SEED_FILE = "types/host-api.d.ts";
export const OUTPUT = `src/harness-seed/${SEED_FILE}`;

/** The seed's runtime copy of `HostMethod`, the names call sites write (`HostMethod.EventsList`). */
export const HOST_METHODS_SEED_FILE = "loop/host-methods.ts";
export const HOST_METHODS_OUTPUT = `src/harness-seed/${HOST_METHODS_SEED_FILE}`;
/** The contract's name table the seed gets a copy of. */
const HOST_METHOD = "HostMethod";

/**
 * Contract exports the host keeps to itself: the handler table and the params schemas' types. The
 * `HostMethod` type is left out too: the seed gets the names as a value, in `loop/host-methods.ts`.
 */
const HOST_ONLY = new Set(["HarnessHostHandlers", "PathBearingMethod", "HarnessParamsProblem", HOST_METHOD]);

/** The protocol's host → harness half: the actions a dispatch carries (and the run spec, the boot notice). */
export const PROTOCOL = "src/shared/protocol.ts";
const PROTOCOL_ROOTS = new Set(["DispatchAction"]);

type TypeDeclaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

const isTypeDeclaration = (node: ts.Node): node is TypeDeclaration =>
  ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);

/** A symbol's declaration as a type: a vocabulary declares a value and a type under one name. */
const typeDeclarationFirst = (symbol: ts.Symbol): ts.Declaration | undefined =>
  symbol.declarations?.find(isTypeDeclaration) ?? symbol.declarations?.[0];

/** The walk over the contract: the program, and the declarations found so far in output order. */
interface Collector {
  root: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  /** `src/shared/` with a trailing `/` ({@link slashed}): the only place a contract type may come from. */
  shared: string;
  order: TypeDeclaration[];
  byName: Map<string, TypeDeclaration>;
  visiting: Set<TypeDeclaration>;
  /** Aliases computed from a value, written out as the union they resolve to. */
  resolved: Map<TypeDeclaration, string>;
}

/**
 * A path with `/` separators, as TypeScript spells every source file's `fileName` on each OS;
 * Node's `path` gives Windows paths backslashes, which would never prefix one.
 */
const slashed = (file: string): string => file.replaceAll("\\", "/");

const hasTypeQuery = (node: ts.Node): boolean =>
  ts.isTypeQueryNode(node) || (ts.forEachChild(node, hasTypeQuery) ?? false);

function fail(root: string, node: ts.Node, message: string): never {
  const source = node.getSourceFile();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart());
  throw new Error(`${path.relative(root, source.fileName)}:${line + 1}: ${message}`);
}

/** A declaration from the TypeScript library or @types/node: global, so not copied. */
function isGlobal(c: Collector, declaration: ts.Declaration): boolean {
  const file = declaration.getSourceFile();
  return c.program.isSourceFileDefaultLibrary(file) || slashed(file.fileName).includes("/@types/node/");
}

/** The declaration a type-position name resolves to, or null for a global (lib, @types/node). */
function declarationOf(c: Collector, name: ts.Node): TypeDeclaration | null {
  const found = c.checker.getSymbolAtLocation(name);
  if (!found) return fail(c.root, name, `cannot resolve ${name.getText()}`);
  const symbol = found.flags & ts.SymbolFlags.Alias ? c.checker.getAliasedSymbol(found) : found;
  if (symbol.flags & ts.SymbolFlags.TypeParameter) return null;
  const declaration = typeDeclarationFirst(symbol);
  if (!declaration) return fail(c.root, name, `${name.getText()} has no declaration`);
  const file = declaration.getSourceFile().fileName;
  if (!slashed(file).startsWith(c.shared)) {
    if (isGlobal(c, declaration)) return null;
    return fail(c.root, name, `${name.getText()} comes from ${path.relative(c.root, file)}, outside src/shared`);
  }
  if (!isTypeDeclaration(declaration)) {
    return fail(
      c.root,
      name,
      `${name.getText()} is a ${ts.SyntaxKind[declaration.kind]}; the contract may only reach interfaces and type aliases`,
    );
  }
  return declaration;
}

/** The union an alias over a value resolves to, spelled as the seed's copy writes it. */
function resolvedUnion(c: Collector, declaration: ts.TypeAliasDeclaration): string {
  if (declaration.typeParameters) fail(c.root, declaration, "a generic alias over `typeof` cannot be resolved");
  return c.checker.typeToString(
    c.checker.getTypeFromTypeNode(declaration.type),
    undefined,
    ts.TypeFormatFlags.NoTruncation |
      ts.TypeFormatFlags.InTypeAlias |
      ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType,
  );
}

/** The name a type reference or an import type points at. */
function referencedName(c: Collector, node: ts.Node): ts.Node | undefined {
  if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
    const target = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
    return ts.isQualifiedName(target) ? target.right : target;
  }
  if (!ts.isImportTypeNode(node)) return undefined;
  const qualifier = node.qualifier ?? fail(c.root, node, "an import type must name a type");
  return ts.isQualifiedName(qualifier) ? qualifier.right : qualifier;
}

/** Every contract type a node refers to, added before the declaration that holds it. */
function addReferences(c: Collector, node: ts.Node): void {
  if (ts.isTypeQueryNode(node)) fail(c.root, node, "a `typeof` in the contract cannot be copied into the seed");
  const name = referencedName(c, node);
  const found = name ? declarationOf(c, name) : null;
  if (found) add(c, found);
  ts.forEachChild(node, (child) => addReferences(c, child));
}

/** Add a declaration to the output, after everything it refers to. */
function add(c: Collector, declaration: TypeDeclaration): void {
  if (c.order.includes(declaration) || c.visiting.has(declaration)) return;
  const name = declaration.name.text;
  const known = c.byName.get(name);
  if (known && known !== declaration) fail(c.root, declaration, `two contract types are named ${name}`);
  c.byName.set(name, declaration);
  c.visiting.add(declaration);
  // An alias computed from a value (`keyof typeof TABLE`, `(typeof LIST)[number]`) is written
  // out as the union it resolves to: the value itself stays in the app.
  if (ts.isTypeAliasDeclaration(declaration) && hasTypeQuery(declaration.type))
    c.resolved.set(declaration, resolvedUnion(c, declaration));
  else ts.forEachChild(declaration, (child) => addReferences(c, child));
  c.visiting.delete(declaration);
  c.order.push(declaration);
}

const isExported = (statement: TypeDeclaration) =>
  Boolean(statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));

const exportedTypes = (file: ts.SourceFile): TypeDeclaration[] =>
  file.statements.filter(
    (statement): statement is TypeDeclaration => isTypeDeclaration(statement) && isExported(statement),
  );

/** The doc comment directly above a declaration; a file header or a section banner is separated from it by a blank line. */
function docComment(declaration: TypeDeclaration): string {
  const text = declaration.getSourceFile().text;
  const last = (ts.getLeadingCommentRanges(text, declaration.getFullStart()) ?? []).at(-1);
  if (!last || text.slice(last.pos, last.pos + 3) !== "/**") return "";
  if (/\n\s*\n/.test(text.slice(last.end, declaration.getStart()))) return "";
  return `${text.slice(last.pos, last.end)}\n`;
}

/** An `import("./x.ts").Y<A>` as the one generated file writes it: `Y<A>`. */
function importTypeText(node: ts.ImportTypeNode, qualifier: ts.EntityName): string {
  const args = node.typeArguments ? `<${node.typeArguments.map((a) => a.getText()).join(", ")}>` : "";
  return `${qualifier.getText()}${args}`;
}

/** A declaration's own text with each `import("./x.ts").Y` written as `Y`: every type now lives in this one file. */
function localizedText(declaration: TypeDeclaration): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const collect = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && node.qualifier) {
      edits.push({ start: node.getStart(), end: node.end, text: importTypeText(node, node.qualifier) });
      return;
    }
    ts.forEachChild(node, collect);
  };
  collect(declaration);
  const start = declaration.getStart();
  const original = declaration.getSourceFile().text.slice(start, declaration.end);
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((body, edit) => body.slice(0, edit.start - start) + edit.text + body.slice(edit.end - start), original);
}

/** One declaration as the generated file writes it: its doc comment, the exported body and where it came from. */
function declarationBlock(c: Collector, declaration: TypeDeclaration): string {
  const union = c.resolved.get(declaration);
  const body = union === undefined ? localizedText(declaration) : `type ${declaration.name.text} = ${union};`;
  const from = path.relative(c.root, declaration.getSourceFile().fileName).replaceAll(path.sep, "/");
  return `${docComment(declaration)}${body.replace(/^(?:export\s+)?(?:declare\s+)?/, "export ")}\n// ↑ ${from}`;
}

/** The contract as a program: the host API and, when present, the protocol's dispatch half. */
function contractProgram(root: string): ts.Program {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  const protocol = path.join(root, PROTOCOL);
  return ts.createProgram({
    rootNames: [path.join(root, CONTRACT), ...(fs.existsSync(protocol) ? [protocol] : [])],
    options: { ...options, noEmit: true },
  });
}

/** The generated file's text for the checkout at `root`. */
export function harnessTypes(root: string): string {
  const program = contractProgram(root);
  const c: Collector = {
    root,
    program,
    checker: program.getTypeChecker(),
    shared: `${slashed(path.join(root, "src/shared"))}/`,
    order: [],
    byName: new Map(),
    visiting: new Set(),
    resolved: new Map(),
  };
  const source = program.getSourceFile(path.join(root, CONTRACT));
  if (!source) throw new Error(`${CONTRACT} is missing`);
  for (const declaration of exportedTypes(source)) if (!HOST_ONLY.has(declaration.name.text)) add(c, declaration);
  const dispatch = program.getSourceFile(path.join(root, PROTOCOL));
  for (const declaration of dispatch ? exportedTypes(dispatch) : [])
    if (PROTOCOL_ROOTS.has(declaration.name.text)) add(c, declaration);

  return [
    "// GENERATED by scripts/gen-harness-types.ts from src/shared/harness-api.ts and src/shared/protocol.ts",
    "// — do not edit. The host contract as the harness sees it: `ctx.call(method, params)` sends",
    '// `HarnessHostApi[method]["params"]` and resolves to `HarnessHostApi[method]["result"]`, and',
    "// `dispatch(action)` receives a `DispatchAction`.",
    "// An app update replaces this file; your own types belong in your own modules.",
    "",
    c.order.map((declaration) => declarationBlock(c, declaration)).join("\n\n"),
    "",
  ].join("\n");
}

/** The members of the contract's `HostMethod` object, in source order: [member name, wire name]. */
function hostMethodMembers(root: string): Array<[string, string]> {
  const file = path.join(root, CONTRACT);
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => ts.isIdentifier(node.name) && node.name.text === HOST_METHOD);
  let value = declaration?.initializer;
  while (value && (ts.isSatisfiesExpression(value) || ts.isAsExpression(value))) value = value.expression;
  if (!value || !ts.isObjectLiteralExpression(value))
    throw new Error(`${CONTRACT} has no \`const ${HOST_METHOD} = { … }\` to copy into the seed`);
  return value.properties.map((property): [string, string] => {
    const wire = ts.isPropertyAssignment(property) ? property.initializer : undefined;
    if (!property.name || !ts.isIdentifier(property.name) || !wire || !ts.isStringLiteral(wire))
      throw new Error(`${CONTRACT}: every ${HOST_METHOD} member must read \`Name: "wire.name"\``);
    return [property.name.text, wire.text];
  });
}

/** The seed's `loop/host-methods.ts` for the checkout at `root`, laid out as Biome formats it. */
export function hostMethods(root: string): string {
  const members = hostMethodMembers(root).map(([member, wire]) => `  ${member}: ${JSON.stringify(wire)},`);
  return [
    "// GENERATED by scripts/gen-harness-types.ts from src/shared/harness-api.ts — do not edit.",
    "// An app update replaces this file; your own names belong in your own modules.",
    'import type { HarnessHostMethod } from "../types/host-api.d.ts";',
    "",
    "/**",
    " * Every host method, as call sites write it: `ctx.call(HostMethod.EventsList, { threadId })`. The",
    " * values are the wire names the host answers to: never rename one.",
    " */",
    `export const ${HOST_METHOD} = {`,
    ...members,
    "} as const satisfies Record<string, HarnessHostMethod>;",
    `export type ${HOST_METHOD} = (typeof ${HOST_METHOD})[keyof typeof ${HOST_METHOD}];`,
    "",
  ].join("\n");
}

/** A file this script generates into the seed: its path there and in the checkout, and its text. */
export interface SeedGenerated {
  seedFile: string;
  output: string;
  generate: (root: string) => string;
}

/** Every file this script generates into the seed. */
export const SEED_GENERATED: readonly SeedGenerated[] = [
  { seedFile: SEED_FILE, output: OUTPUT, generate: harnessTypes },
  { seedFile: HOST_METHODS_SEED_FILE, output: HOST_METHODS_OUTPUT, generate: hostMethods },
];

/** Whether the committed copies at `root` are what the generator writes now: null, or why not. */
export function harnessTypesDrift(root: string): string | null {
  for (const { output, generate } of SEED_GENERATED) {
    const file = path.join(root, output);
    if (!fs.existsSync(file)) return `${output} is missing: run node scripts/gen-harness-types.ts`;
    if (fs.readFileSync(file, "utf8") !== generate(root))
      return `${output} is out of date: run node scripts/gen-harness-types.ts`;
  }
  return null;
}

/** Rewrite each generated seed file at `root` that differs from what the generator writes now. */
function writeGenerated(root: string): void {
  for (const { output, generate } of SEED_GENERATED) {
    const file = path.join(root, output);
    const text = generate(root);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote ${output}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const checkOnly = process.argv.includes("--check");
  const drift = checkOnly ? harnessTypesDrift(root) : null;
  if (drift) {
    console.error(drift);
    process.exitCode = 1;
  }
  if (!checkOnly) writeGenerated(root);
}
