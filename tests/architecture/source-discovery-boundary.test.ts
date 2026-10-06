import "../helpers/network-guard";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

test("discovery import and mutation boundary is isolated from production writers and legacy", () => {
  const directory = resolve("lib/source-discovery");
  const files = readdirSync(directory, { recursive: true }).filter(name => String(name).endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(resolve(directory, String(file)), "utf8");
    const syntax = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function visit(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        assert.ok(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!));
        imports.push((node.arguments[0] as ts.StringLiteral).text);
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    for (const dependency of imports) {
      if (!dependency.startsWith(".")) {
        assert.ok(dependency.startsWith("node:") || dependency === "cheerio");
        continue;
      }
      const path = resolve(directory, String(file), "..", dependency).replaceAll("\\", "/");
      assert.ok(path.includes("/lib/source-discovery/") || path.endsWith("/lib/ingestion/normalization/canonical-artifact-registry")
        || (String(file) === "admission-proposal.ts" && (path.endsWith("/lib/application/source-admission/types") || path.endsWith("/lib/application/source-admission/source-admission-register"))), path);
    }
    assert.doesNotMatch(source, /issueContinuous|reserveContinuous|InMemorySourceAdmissionRegister|bootstrapTrustedChain|materializePosition|materializePresentation|match_score|non_law_rule|CandidateProfile|fetch\(/);
    if (String(file) === "admission-proposal.ts") {
      assert.doesNotMatch(source, /\.register\(|\.revise\(/);
      assert.match(source, /validateSourceAdmission\(draft\)/);
    }
  }
});
