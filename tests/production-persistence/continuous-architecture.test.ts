import "../helpers/network-guard";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const paths = ["lib/application/source-admission/continuous-acquisition.ts", "lib/production-persistence/continuous-source-context.ts",
  "lib/production-persistence/continuous-request-gate.ts", "lib/production-persistence/git-source-registry-persistence.ts"];

function closure(start: string, seen = new Set<string>()): Set<string> {
  const absolute = path.resolve(start); if (seen.has(absolute)) return seen; seen.add(absolute);
  const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (ts.isImportDeclaration(statement) && (statement.importClause?.isTypeOnly
      || (statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        && !statement.importClause.name && statement.importClause.namedBindings.elements.every(element => element.isTypeOnly)))) continue;
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const locator = statement.moduleSpecifier.text; if (!locator.startsWith(".")) continue;
    const base = path.resolve(path.dirname(absolute), locator);
    const target = [base + ".ts", path.join(base, "index.ts")].find(existsSync);
    assert.ok(target, `Runtime import must resolve: ${absolute} -> ${locator}`); closure(target, seen);
  }
  return seen;
}
test("continuous gate runtime import closure has zero candidate, eligibility, presentation, database, legacy, scheduled or test evidence authority", () => {
  for (const entry of paths) {
    for (const target of closure(entry)) {
      const relative = path.relative(process.cwd(), target).replaceAll("\\", "/");
      assert.doesNotMatch(relative, /(?:tests\/|verification\/|scheduler|live-canary|preview|shadow|production-ingestion|postgres|supabase|crawler|scoring|\/sync\.|\/jobs\.|candidate-evidence|eligibility|presentation)/i);
      assert.doesNotMatch(readFileSync(target, "utf8"), /\b(?:CandidateProfile|match_score|non_law_rule|runJobSync)\b/u);
    }
  }
});
test("existing Admission owns the ledger; production root calls the per-attempt gate rather than trusting permission or caller grants", () => {
  const owner = readFileSync("lib/application/source-admission/source-admission-register.ts", "utf8");
  const source = readFileSync("lib/production-persistence/zero-cost-production-composition-root.ts", "utf8");
  assert.match(owner, /#continuousRecords/u); assert.match(owner, /replayContinuousRecords/u);
  assert.match(source, /executeContinuousRequest/u); assert.match(source, /continuous_authorization_ids/u);
  assert.match(source, /CONTINUOUS_EXECUTION_REQUIRES_COMMITTED_SOURCE_STATE/u);
  for (const file of paths.slice(0, 3)) assert.doesNotMatch(readFileSync(file, "utf8"), /class\s+\w*(?:Continuous|Authorization|Admission|SourceRegistry)/u);
  const gate = readFileSync(paths[2]!, "utf8");
  assert.ok(gate.indexOf("await repository.publishContinuousRecord(reserve") < gate.indexOf("await executeContinuousOfficialRequest(request"));
  assert.doesNotMatch(gate, /input\.transport|setTimeout|HUMAN_REVIEWED_CANARY/u);
});
