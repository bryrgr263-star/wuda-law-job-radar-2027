import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEvidence } from "./fresh-clone-acceptance";

const baseline = "production repository delegates SOV construction to the shared materializer";
const inventory = [
  { file: "tests/first.test.ts", names: ["first anchor"] },
  { file: "tests/second.test.ts", names: ["CR#12 second anchor", baseline] }
];
const log = [
  "TAP version 13",
  "# FRESH_CLONE_OLD_WORKTREE_READ_GUARD=ACTIVE; NEGATIVE_PROBES=PASS",
  "# Subtest: first anchor", "ok 1 - first anchor",
  "# UNEXPECTED_ORIGINAL_WORKTREE_READS=0",
  "# FRESH_CLONE_OLD_WORKTREE_READ_GUARD=ACTIVE; NEGATIVE_PROBES=PASS",
  "# Subtest: CR\\#12 second anchor", "ok 2 - CR\\#12 second anchor",
  `# Subtest: ${baseline}`, `not ok 3 - ${baseline}`,
  "error: The input did not match the regular expression /prepareSourceOccurrenceMaterialization/u.",
  "# UNEXPECTED_ORIGINAL_WORKTREE_READS=0",
  "1..3", "# tests 3", "# pass 2", "# fail 1", "# cancelled 0",
  "# skipped 0", "# todo 0", "# duration_ms 1"
].join("\n");

test("guard expectation comes from each discovered file, not an extra parent invocation", () => {
  const result = evaluateEvidence(log, inventory, 1);
  assert.equal(result.accepted, true);
  assert.equal(result.expected_guard_launches, inventory.length);
  assert.equal(result.mappings.length, inventory.length);
});

test("acceptance failure retains independently known failure classification", () => {
  const result = evaluateEvidence(log.replace("# UNEXPECTED_ORIGINAL_WORKTREE_READS=0", ""), inventory, 1);
  assert.equal(result.accepted, false);
  assert.equal(result.baseline_failure_count, 1);
  assert.equal(result.new_regression_count, 0);
});

test("missing or duplicated guard coverage cannot pass by matching totals", () => {
  const missing = evaluateEvidence(log.replace("# Subtest: first anchor", "# Subtest: wrong anchor"), inventory, 1);
  assert.equal(missing.accepted, false);
  const duplicate = evaluateEvidence(log.replace("# Subtest: CR\\#12 second anchor", "# Subtest: first anchor"), inventory, 1);
  assert.equal(duplicate.accepted, false);
});

test("nonzero unexpected reads and absent exits reject acceptance", () => {
  assert.equal(evaluateEvidence(log.replace("UNEXPECTED_ORIGINAL_WORKTREE_READS=0", "UNEXPECTED_ORIGINAL_WORKTREE_READS=1"), inventory, 1).accepted, false);
  assert.equal(evaluateEvidence(log.replaceAll("# UNEXPECTED_ORIGINAL_WORKTREE_READS=0", ""), inventory, 1).accepted, false);
});

test("truncated footer does not invent failure classification", () => {
  const result = evaluateEvidence(log.split("1..3")[0], inventory, 1);
  assert.equal(result.accepted, false);
  assert.equal(result.baseline_failure_count, null);
  assert.equal(result.new_regression_count, null);
});

test("new failures and a changed baseline error are not accepted as historical failures", () => {
  const changed = evaluateEvidence(log.replace("/prepareSourceOccurrenceMaterialization/u", "/different/u"), inventory, 1);
  assert.equal(changed.baseline_failure_count, 0);
  assert.equal(changed.new_regression_count, 1);
  assert.equal(changed.accepted, false);
  const added = evaluateEvidence(log.replace("ok 1 - first anchor", "not ok 1 - first anchor").replace("# pass 2", "# pass 1").replace("# fail 1", "# fail 2"), inventory, 1);
  assert.equal(added.baseline_failure_count, 1);
  assert.equal(added.new_regression_count, 1);
  assert.equal(added.accepted, false);
});

test("complete all-pass evidence is allowed without requiring the historical failure", () => {
  const passing = log.replace(`not ok 3 - ${baseline}`, `ok 3 - ${baseline}`).replace("# pass 2", "# pass 3").replace("# fail 1", "# fail 0");
  const result = evaluateEvidence(passing, inventory, 0);
  assert.equal(result.accepted, true);
  assert.equal(result.baseline_failure_count, 0);
  assert.equal(result.new_regression_count, 0);
});

test("extra invocation, reordered files, missing inventory and exit mismatch fail closed", () => {
  assert.equal(evaluateEvidence(log + "\n# FRESH_CLONE_OLD_WORKTREE_READ_GUARD=ACTIVE; NEGATIVE_PROBES=PASS\n# UNEXPECTED_ORIGINAL_WORKTREE_READS=0", inventory, 1).accepted, false);
  assert.equal(evaluateEvidence(log, [...inventory].reverse(), 1).accepted, false);
  assert.equal(evaluateEvidence(log, [], 1).accepted, false);
  assert.equal(evaluateEvidence(log, inventory, 0).accepted, false);
});

test("duplicate inventory and unclosed guard blocks fail closed", () => {
  assert.equal(evaluateEvidence(log, [inventory[0], inventory[0]], 1).accepted, false);
  const nested = log.replace("# Subtest: first anchor", "# FRESH_CLONE_OLD_WORKTREE_READ_GUARD=ACTIVE; NEGATIVE_PROBES=PASS\n# Subtest: first anchor");
  assert.equal(evaluateEvidence(nested, inventory, 1).accepted, false);
});

test("duplicate or inconsistent summary does not fabricate verified classification", () => {
  const duplicate = evaluateEvidence(log + "\n# fail 1", inventory, 1);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.new_regression_count, null);
  const inconsistent = evaluateEvidence(log.replace("# fail 1", "# fail 0"), inventory, 1);
  assert.equal(inconsistent.accepted, false);
  assert.equal(inconsistent.baseline_failure_count, null);
});

test("baseline error text must belong to that exact failed test", () => {
  const unrelated = log.replace("error: The input did not match the regular expression /prepareSourceOccurrenceMaterialization/u.", "error: Different failure\n# Subtest: unrelated passing test\nerror: The input did not match the regular expression /prepareSourceOccurrenceMaterialization/u.");
  const result = evaluateEvidence(unrelated, inventory, 1);
  assert.equal(result.accepted, false);
  assert.equal(result.baseline_failure_count, 0);
  assert.equal(result.new_regression_count, 1);
});

test("classification remains intact when every guard block is absent", () => {
  const withoutGuard = log.split("\n").filter(line => !line.includes("FRESH_CLONE_OLD_WORKTREE_READ_GUARD") && !line.includes("UNEXPECTED_ORIGINAL_WORKTREE_READS")).join("\n");
  const result = evaluateEvidence(withoutGuard, inventory, 1);
  assert.equal(result.accepted, false);
  assert.equal(result.missing_guard_coverage.length, inventory.length);
  assert.equal(result.baseline_failure_count, 1);
  assert.equal(result.new_regression_count, 0);
});
