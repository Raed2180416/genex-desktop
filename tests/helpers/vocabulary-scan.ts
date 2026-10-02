/**
 * The string vocabularies of a set of sources, for the conformance scans that read names out of
 * code: `const CustomEvent = { RunFinished: "run_finished" } as const` makes
 * `CustomEvent.RunFinished` stand for `"run_finished"` wherever it is written. The scans parse
 * without resolving imports, so a vocabulary is found by the name it is declared under, in any
 * scanned file.
 */
import ts from "@typescript/typescript6";

/** Vocabulary name → member name → the literal values it stands for (one per declaring file). */
export type Vocabularies = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

const isObjectFreeze = (callee: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(callee) &&
  ts.isIdentifier(callee.expression) &&
  callee.expression.text === "Object" &&
  callee.name.text === "freeze";

const unwrap = (node: ts.Expression): ts.Expression => {
  const wrapped =
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node);
  if (wrapped) return unwrap(node.expression);
  // `Object.freeze({ … })`
  const [argument] = ts.isCallExpression(node) && isObjectFreeze(node.expression) ? node.arguments : [];
  return argument ? unwrap(argument) : node;
};

/** The members of an object literal whose every property is a string literal, or null. */
function stringMembers(literal: ts.ObjectLiteralExpression): Map<string, string> | null {
  const members = new Map<string, string>();
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const key = property.name;
    const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
    const value = unwrap(property.initializer);
    if (name === null || !ts.isStringLiteralLike(value)) return null;
    members.set(name, value.text);
  }
  return members.size > 0 ? members : null;
}

/** Every top-level-or-nested `const Name = { Key: "value", … }` in these sources. */
export function stringVocabularies(sources: Iterable<ts.SourceFile>): Vocabularies {
  const found = new Map<string, Map<string, string[]>>();
  const record = (name: string, members: Map<string, string>) => {
    const table = found.get(name) ?? new Map<string, string[]>();
    for (const [member, value] of members) {
      const values = table.get(member) ?? [];
      if (!values.includes(value)) values.push(value);
      table.set(member, values);
    }
    found.set(name, table);
  };
  for (const source of sources) {
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = unwrap(node.initializer);
        const members = ts.isObjectLiteralExpression(value) ? stringMembers(value) : null;
        if (members) record(node.name.text, members);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** The literal values `Vocabulary.Member` stands for, or [] for any other expression. */
export function vocabularyValues(vocabularies: Vocabularies, node: ts.Expression): readonly string[] {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return [];
  return vocabularies.get(node.expression.text)?.get(node.name.text) ?? [];
}
