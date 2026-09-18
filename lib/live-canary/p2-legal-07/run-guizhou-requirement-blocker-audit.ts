import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RequirementSetCompositionResult } from "../p2-legal-06/guizhou-legal-requirement-set-composer";
import {
  auditRequirementBlockers,
  buildRequirementBlockerAuditReport
} from "./guizhou-requirement-blocker-audit";

const compositionPath = path.resolve(
  "outputs",
  "p2-legal-06",
  "p2-legal-06-job-22828700101",
  "requirement-set-composition.json"
);
const outputDirectory = path.resolve("outputs", "p2-legal-07");

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const composition = JSON.parse(
    await readFile(compositionPath, "utf8")
  ) as RequirementSetCompositionResult;
  const audit = auditRequirementBlockers(composition);
  const report = buildRequirementBlockerAuditReport(audit);

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, "p2-legal-07-blocker-audit.json"), audit);
  await writeJson(path.join(outputDirectory, "p2-legal-07-blocker-audit-report.json"), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
