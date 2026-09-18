import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
assert.equal(config.error, undefined);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const historicalTests = [
  "tests/p2-acq-01/official-html-xlsx-canary.test.ts",
  "tests/p2-legal-05/guizhou-legal-xlsx-requirement-extraction.test.ts",
  "tests/p2-legal-06/guizhou-legal-requirement-set-composition.test.ts",
  "tests/p2-legal-07/guizhou-requirement-blocker-audit.test.ts",
  "tests/normalization/trusted-source-occurrence-registry.test.ts",
  "tests/normalization/position-identity-resolver.test.ts",
  "tests/normalization/position-version-tracker.test.ts",
  "tests/canonicalization/position-bound-opportunity-tracker.test.ts",
  "tests/p2-legal-08b/target-source-composition.test.ts"
];

function assertProductionBoundary(relative: string): void {
  assert.doesNotMatch(relative.replaceAll("\\", "/"), /(?:^|\/)tests(?:\/|$)|historical-evidence/,
    "Production dependency reaches TEST_ONLY historical evidence");
}

function closure(seed: string): string[] {
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    const relative = path.relative(root, file);
    assertProductionBoundary(relative);
    visited.add(file);
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /historical-evidence|beijing-public-institution-job-(?:detail\.html|table\.xlsx)/,
      `${relative} reads historical fixture data`);
    if (!/\.tsx?$/.test(file)) return;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    function walk(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        && ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        assert.ok(node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]),
          `${relative}: nonliteral module dependency requires explicit boundary review`);
        specifiers.push((node.arguments[0] as ts.StringLiteralLike).text);
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
        && ts.isStringLiteralLike(node.argument.literal)) specifiers.push(node.argument.literal.text);
      ts.forEachChild(node, walk);
    }
    walk(parsed);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      assert.ok(resolved, `${relative}: unresolved ${specifier}`);
      assert.ok(!path.relative(root, resolved.resolvedFileName).startsWith(".."),
        `${relative}: local import leaves checkout`);
      visit(resolved.resolvedFileName);
    }
  }
  visit(path.join(root, seed));
  return [...visited];
}

for (const seed of [
  "lib/ingestion/index.ts",
  "lib/production-persistence/zero-cost-production-composition-root.ts",
  "lib/presentation-read-api/runtime.ts",
  "app/api/presentation/v1/[...segments]/route.ts"
]) {
  test(`${seed} transitive production import closure excludes historical TEST_ONLY evidence`, () => {
    assert.ok(closure(seed).length > 0);
  });
}

test("production fixture guard rejects forbidden helper and fixture dependency paths", () => {
  for (const forbidden of ["tests/helpers/historical-evidence.ts", "tests/fixtures/historical-evidence/raw.xlsx"]) {
    assert.throws(() => assertProductionBoundary(forbidden), /TEST_ONLY/);
  }
});

test("all nine historical tests use portable logical evidence references only", () => {
  assert.equal(historicalTests.length, 9);
  for (const file of historicalTests) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.match(source, /from "\.\.\/helpers\/historical-evidence"/);
    assert.doesNotMatch(source, /outputs\/|\.local_artifact|[A-Z]:\\|C:\//i, file);
  }
});
