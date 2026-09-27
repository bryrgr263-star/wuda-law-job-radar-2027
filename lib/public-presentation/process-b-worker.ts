import { execFileSync } from "node:child_process";
import { bootstrapTrustedChainCompositionRoot, type TrustedChainCommand } from "../ingestion";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { GitAppendOnlyExecutionStore } from "../production-persistence/git-append-only-execution-store";
import { GitRawObjectPersistence, createRawValidatedRestorationJournal } from "../production-persistence/git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "../production-persistence/git-source-registry-persistence";

async function main() {
  const [repositoryPath, authoritativeSha, streamId] = process.argv.slice(2);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8", windowsHide: true }).trim();
  if (git("rev-parse", "HEAD") !== authoritativeSha) throw new Error("PUBLIC_SHA_MISMATCH");
  const store = new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: repositoryPath, stream_id: streamId, scope: "PRODUCTION" });
  const validated = createRawValidatedRestorationJournal(new GitRawObjectPersistence({ repository_path: repositoryPath }),
    store, new GitSourceRegistryPersistence({ repository_path: repositoryPath }));
  const restored = await bootstrapTrustedChainCompositionRoot({ scope: "PRODUCTION",
    restoration_journal: { ...validated, appendExecution: async () => { throw new Error("PUBLIC_REPLAY_WRITE_FORBIDDEN"); } } });
  const current = store.readCurrentSnapshot();
  if (!current || current.authoritative_head !== authoritativeSha || current.scope !== "PRODUCTION") throw new Error("PUBLIC_CURRENT_UNAVAILABLE");
  for (const model of current.current_position_read_models) {
    const trusted = restored.root.resolvers.presentation_read_models.resolve(model.presentation_read_model_id);
    const decision = restored.root.resolvers.presentation_decisions.resolve(model.presentation_decision_id);
    if (!trusted || canonicalSerialize(trusted) !== canonicalSerialize(model)
      || !decision || decision.integrity_hash !== model.upstream.decision_integrity_hash) throw new Error("PUBLIC_REPLAY_MODEL_MISMATCH");
  }
  if (git("rev-parse", "HEAD") !== authoritativeSha) throw new Error("PUBLIC_SHA_MISMATCH");
  const epoch = Number(git("show", "-s", "--format=%ct", authoritativeSha));
  if (!Number.isSafeInteger(epoch)) throw new Error("PUBLIC_COMMIT_TIME_INVALID");
  process.stdout.write(JSON.stringify({ authoritative_sha: authoritativeSha,
    generated_at: new Date(epoch * 1000).toISOString(), current_snapshot: current }));
}
main().catch(() => { process.stderr.write("PUBLIC_PROCESS_B_VALIDATION_FAILED\n"); process.exitCode = 1; });
