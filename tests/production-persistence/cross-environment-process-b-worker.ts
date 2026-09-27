import "../helpers/network-guard";

import assert from "node:assert/strict";
import { bootstrapTrustedChainCompositionRoot, type PresentationDecision, type PresentationReadModel, type TrustedChainCommand, type TrustedRestorationExecution } from "../../lib/ingestion";
import { canonicalDeserialize, canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import { GitRawObjectPersistence, createRawValidatedRestorationJournal } from "../../lib/production-persistence/git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";

async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "native" || mode === "en-US" || mode === "zh-CN");
  const originalCompare = String.prototype.localeCompare;
  if (mode !== "native") {
    String.prototype.localeCompare = function(other, locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
      return originalCompare.call(this, other, locales ?? mode, options);
    };
  }
  try {
    const repositoryPath = process.argv[3];
    assert.ok(repositoryPath);
    const store = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
      repository_path: repositoryPath,
      stream_id: "initial-production-source-activation",
      scope: "PRODUCTION"
    });
    const verified = createRawValidatedRestorationJournal(
      new GitRawObjectPersistence({ repository_path: repositoryPath }),
      store,
      new GitSourceRegistryPersistence({ repository_path: repositoryPath })
    );
    const records = (await verified.list()).slice(0, 26);
    assert.equal(records.length, 26);
    const record = records[10];
    assert.equal(record.sequence, 11);
    assert.equal(record.command_kind, "POSITION_VERSION_MATERIALIZE");
    assert.equal(record.command_hash, "abc9534b001ac63626f8f281b592a947c1b792771b7eedbf5a8f7c56029eaa19");
    assert.equal(record.result_hash, "23320bdedad84cd295fc3b1eb3544c0a7194da0b7f585369742952f0dcdcd3a3");
    const captured: TrustedRestorationExecution<TrustedChainCommand>[] = [];
    const prefix = await bootstrapTrustedChainCompositionRoot({
      scope: "PRODUCTION",
      restoration_journal: {
        ...verified,
        list: async () => records.slice(0, 10),
        appendExecution: async (execution) => {
          captured.push(execution);
          return "APPENDED";
        }
      }
    });
    const result = await prefix.root.execute(record.command, record.provenance);
    assert.equal(canonicalHash(result), record.result_hash);
    assert.deepEqual(captured[0].record.expected_artifacts, record.expected_artifacts);
    const expected = store.listVerifiedExecutions()[10].artifact_envelopes;
    assert.deepEqual(captured[0].artifact_envelopes.map((artifact) => artifact.canonical_bytes),
      expected.map((artifact) => artifact.canonical_bytes));
    const full = await bootstrapTrustedChainCompositionRoot({
      scope: "PRODUCTION",
      restoration_journal: {
        ...verified,
        list: async () => records,
        appendExecution: async () => { throw new Error("Replay must not write"); }
      }
    });
    assert.equal(full.restored_record_count, 26);
    let decisions = 0;
    let models = 0;
    for (const execution of store.listVerifiedExecutions().slice(0, 26)) {
      for (const artifact of execution.artifact_envelopes) {
        if (artifact.artifact_kind === "PRESENTATION_DECISION") {
          const expectedDecision = canonicalDeserialize<PresentationDecision>(artifact.canonical_bytes);
          const restored = full.root.resolvers.presentation_decisions.resolve(expectedDecision.presentation_decision_id);
          assert.equal(canonicalSerialize(restored), artifact.canonical_bytes);
          decisions += 1;
        }
        if (artifact.artifact_kind === "PRESENTATION_READ_MODEL") {
          const expectedModel = canonicalDeserialize<PresentationReadModel>(artifact.canonical_bytes);
          const restored = full.root.resolvers.presentation_read_models.resolve(expectedModel.presentation_read_model_id);
          assert.equal(canonicalSerialize(restored), artifact.canonical_bytes);
          models += 1;
        }
      }
    }
    assert.equal(decisions, 4);
    assert.equal(models, 4);
    console.log(JSON.stringify({ mode, replayed: 26, decisions, models, sequence11: "MATCH", platform: process.platform, icu: process.versions.icu }));
  } finally {
    String.prototype.localeCompare = originalCompare;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
