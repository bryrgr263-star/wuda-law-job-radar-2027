import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

interface InventoryEntry {
  file: string;
  names: string[];
}

interface GuardBlock {
  start: number;
  end: number | null;
  names: string[];
  unexpectedReads: number | null;
}

const baselineName = "production repository delegates SOV construction to the shared materializer";
const startMarker = "# FRESH_CLONE_OLD_WORKTREE_READ_GUARD=ACTIVE; NEGATIVE_PROBES=PASS";

export function evaluateEvidence(log: string, inventory: InventoryEntry[], exitCode: number) {
  const blocks: GuardBlock[] = [];
  let current: GuardBlock | undefined;
  let malformedCoverage = false;
  let exitReports = 0;
  for (const [index, line] of log.split(/\r?\n/u).entries()) {
    if (line === startMarker) {
      if (current) malformedCoverage = true;
      current = { start: index + 1, end: null, names: [], unexpectedReads: null };
      blocks.push(current);
    }
    if (current && line.startsWith("# Subtest: ")) {
      current.names.push(line.slice("# Subtest: ".length).replaceAll("\\#", "#"));
    }
    const exit = /^# UNEXPECTED_ORIGINAL_WORKTREE_READS=([0-9]+)$/u.exec(line);
    if (exit) {
      exitReports += 1;
      if (!current) {
        malformedCoverage = true;
      } else {
        current.end = index + 1;
        current.unexpectedReads = Number(exit[1]);
        current = undefined;
      }
    }
  }
  if (current) malformedCoverage = true;
  const mappings = inventory.map((entry, index) => {
    const block = blocks[index];
    const anchor = block?.names.find(name => entry.names.includes(name)
      && inventory.filter(other => other.names.includes(name)).length === 1);
    const foreignAnchor = block?.names.some(name => !entry.names.includes(name)
      && inventory.some(other => other.names.includes(name)));
    return {
      file: entry.file,
      guard_launch_line: block?.start ?? null,
      guard_exit_line: block?.end ?? null,
      unique_test_anchor: anchor ?? null,
      covered: !!anchor && !foreignAnchor && block?.end !== null && block?.unexpectedReads === 0
    };
  });
  const fields = ["tests", "pass", "fail", "cancelled", "skipped", "todo"] as const;
  const counts = Object.fromEntries(fields.map(field => {
    const matches = [...log.matchAll(new RegExp(`^# ${field} ([0-9]+)\\s*$`, "gm"))];
    return [field, matches.length === 1 ? Number(matches[0][1]) : null];
  })) as Record<typeof fields[number], number | null>;
  const failures = [...log.matchAll(/^not ok [0-9]+ - ([^\r\n]+)$/gm)];
  const classifiedFailures = failures.map(failure => {
    const start = failure.index!;
    const remaining = log.slice(start);
    const nextSubtest = remaining.indexOf("\n# Subtest: ");
    const details = nextSubtest === -1 ? remaining : remaining.slice(0, nextSubtest);
    return {
      name: failure[1].replaceAll("\\#", "#"),
      baseline: failure[1] === baselineName
        && details.includes("The input did not match the regular expression /prepareSourceOccurrenceMaterialization/u")
    };
  });
  const complete = /^# duration_ms [0-9.]+\s*$/mu.test(log)
    && fields.every(field => counts[field] !== null)
    && counts.tests === counts.pass! + counts.fail! + counts.cancelled! + counts.skipped! + counts.todo!
    && counts.fail === classifiedFailures.length;
  const baselineCount = complete ? classifiedFailures.filter(failure => failure.baseline).length : null;
  const newCount = complete ? classifiedFailures.filter(failure => !failure.baseline).length : null;
  const coverage = !malformedCoverage && inventory.length > 0
    && new Set(inventory.map(entry => entry.file)).size === inventory.length
    && blocks.length === inventory.length && exitReports === inventory.length
    && mappings.every(mapping => mapping.covered);
  const accepted = complete && coverage && newCount === 0 && baselineCount! <= 1
    && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0
    && exitCode === (counts.fail! > 0 ? 1 : 0);
  return {
    accepted,
    status: accepted ? "COMPLETE_ACCEPTED" : "COMPLETE_NOT_ACCEPTED",
    exit_code: exitCode,
    counts,
    full_footer_present: complete,
    expected_guard_launches: inventory.length,
    guard_launches: blocks.length,
    guard_normal_exits: blocks.filter(block => block.end !== null && block.unexpectedReads === 0).length,
    guard_abnormal_or_missing_exits: blocks.filter(block => block.end === null || block.unexpectedReads !== 0).length,
    missing_guard_coverage: mappings.filter(mapping => !mapping.covered).map(mapping => mapping.file),
    baseline_failure_count: baselineCount,
    new_regression_count: newCount,
    failures: classifiedFailures,
    mappings
  };
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], { encoding: "utf8" }).trim();
}

export function reEvaluateExistingEvidence(root: string, logPath: string, statusPath: string, expectedHead: string) {
  const head = git(root, "rev-parse", "HEAD");
  if (head !== expectedHead || git(root, "status", "--porcelain=v1") !== "") {
    throw new Error("Evidence clone must retain the exact baseline HEAD and a clean worktree");
  }
  const statusBytes = readFileSync(statusPath);
  const status = JSON.parse(statusBytes.toString("utf8").replace(/^\uFEFF/u, ""));
  if (path.resolve(status.clone) !== path.resolve(root) || path.resolve(status.log) !== path.resolve(logPath)
    || status.actual_sha !== head || status.expected_sha !== head
    || !Number.isInteger(status.exit_code) || !status.completed_at_utc) {
    throw new Error("Original status does not bind the completed run to this clone and log");
  }
  const files = git(root, "ls-files", "tests").split(/\r?\n/u)
    .filter(file => file.endsWith(".test.ts"))
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  const fileHashes: Record<string, string> = {};
  const inventory = files.map(file => {
    const bytes = readFileSync(path.join(root, file));
    fileHashes[file] = hash(bytes);
    const source = ts.createSourceFile(file, bytes.toString("utf8"), ts.ScriptTarget.Latest, true);
    const names: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])
        && /^(test|it|describe)(\.|$)/u.test(node.expression.getText(source))) {
        names.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return { file, names };
  });
  const logBytes = readFileSync(logPath);
  const log = logBytes.toString("utf8");
  const evaluated = evaluateEvidence(log, inventory, status.exit_code);
  const factsConsistent = status.test_files === files.length
    && Object.entries(evaluated.counts).every(([field, count]) => status[field] === count)
    && status.guard_active_reports === evaluated.guard_launches
    && status.guard_clean_exit_reports === evaluated.guard_normal_exits
    && status.guard_unexpected_read === false;
  const processB = /^ok [0-9]+ - committed production boundary reuses original SOV through support and an independent Process B restores exact bindings\s*$/mu.test(log)
    && /^ok [0-9]+ - fresh composition root replays the complete trusted chain after restart\s*$/mu.test(log);
  if (git(root, "rev-parse", "HEAD") !== head || git(root, "status", "--porcelain=v1") !== ""
    || hash(readFileSync(logPath)) !== hash(logBytes) || hash(readFileSync(statusPath)) !== hash(statusBytes)) {
    throw new Error("Evidence changed during re-evaluation");
  }
  const accepted = evaluated.accepted && factsConsistent && processB;
  return {
    ...evaluated,
    accepted,
    status: accepted ? "COMPLETE_ACCEPTED_WITH_PRE_EXISTING_BASELINE_FAILURE" : "COMPLETE_NOT_ACCEPTED",
    original_status: status.status,
    original_status_preserved: true,
    original_status_sha256: hash(statusBytes),
    log_sha256: hash(logBytes),
    file_hashes: fileHashes,
    fresh_clone_head: head,
    process_b_restoration: processB,
    run_facts_consistent: factsConsistent,
    full_regression_rerun: false
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, logPath, statusPath, expectedHead] = process.argv.slice(2);
  if (!root || !logPath || !statusPath || !expectedHead) {
    throw new Error("Usage: fresh-clone-acceptance.ts <clone> <log> <original-status> <baseline-head>");
  }
  const result = reEvaluateExistingEvidence(root, logPath, statusPath, expectedHead);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.accepted) process.exitCode = 1;
}
