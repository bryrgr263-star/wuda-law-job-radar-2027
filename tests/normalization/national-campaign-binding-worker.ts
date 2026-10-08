import "../helpers/network-guard";
import { readFileSync } from "node:fs";
import { bootstrapTrustedChainCompositionRoot, type TrustedChainCommand, type TrustedRestorationExecution } from "../../lib/ingestion";
import type { SOVDiscoveryEvidence } from "../../lib/ingestion/normalization/source-discovery-support";

async function main() {
  const saved = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
    executions: TrustedRestorationExecution<TrustedChainCommand>[];
    evidence: (Omit<SOVDiscoveryEvidence, "raw_blob"> & { raw_blob: Omit<SOVDiscoveryEvidence["raw_blob"], "bytes"> & { bytes: number[] } })[];
  };
  const evidence = saved.evidence.map(item => ({ ...item, raw_blob: { ...item.raw_blob, bytes: new Uint8Array(item.raw_blob.bytes) } }));
  const journal = {
    async list() { return saved.executions.map(execution => execution.record); },
    async appendExecution() { throw new Error("TEST_ONLY replay is read-only"); },
    async readArtifactEnvelope(kind: string, id: string, scope: string) {
      return saved.executions.flatMap(execution => execution.artifact_envelopes)
        .find(envelope => envelope.artifact_kind === kind && envelope.artifact_id === id && envelope.scope === scope) ?? null;
    },
    async readVerifiedDiscovery(snapshotId: string, recordId: string) {
      const matches = evidence.filter(item => item.snapshot.snapshot_id === snapshotId && item.extracted_record.extracted_record_id === recordId);
      if (matches.length !== 1) throw new Error("EVIDENCE_BLOCKED: TEST_ONLY orphan dependency");
      return matches[0]!;
    }
  };
  try {
    await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
    process.stdout.write("REPLAY_VERIFIED\n");
  } catch { process.stdout.write("REPLAY_BLOCKED\n"); }
}

main().catch(() => { process.exitCode = 1; });
