import { execFileSync } from "node:child_process";
import type { ContinuousFencingVerifier } from "../application/source-admission/continuous-acquisition";
import { AdapterExtractionError, createExtractedRecordV2, type RecruitmentEndpoint, type TrustedChainCommand } from "../ingestion";
import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { SOVDiscoverySupportError, validateDiscoveryEvidence } from "../ingestion/normalization/source-discovery-support";
import { CHNENERGY_CAMPAIGN_URL, CHNENERGY_JOBS, CHNENERGY_SOURCE_ID,
  Chnenergy2027CampaignHtmlAdapter, type ChnenergyRetainedReference } from "../production-sources/chnenergy-2027-source";
import { CHNENERGY_SUPPORT_ADAPTER_KEY, ChnenergySupportingEvidenceAdapter } from "../production-sources/chnenergy-supporting-evidence";
import { GitAppendOnlyExecutionStore } from "./git-append-only-execution-store";
import { createRawValidatedRestorationJournal, GitRawObjectPersistence } from "./git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "./git-source-registry-persistence";
import { supportingInspectionReplay } from "./source-inspection-replay";

export async function selectRetainedNationalAdapter(repositoryPath: string, streamId: string, endpoint: RecruitmentEndpoint,
  fencingVerifier?: ContinuousFencingVerifier) {
  const job = CHNENERGY_JOBS.find(candidate => candidate.url === endpoint.locator);
  if (!job || endpoint.source_definition_id !== CHNENERGY_SOURCE_ID) return null;
  const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8", windowsHide: true }).trim();
  const pinned = head();
  const source = new GitSourceRegistryPersistence({ repository_path: repositoryPath, fencing_verifier: fencingVerifier });
  const versions = await source.listVersions();
  const replay = supportingInspectionReplay(versions);
  const urls = [CHNENERGY_CAMPAIGN_URL, job.membership_url];
  const relevant = replay.current.filter(record => urls.includes(record.exact_url));
  if (!relevant.length) {
    if (head() !== pinned) throw new Error("NATIONAL_SUPPORTING_HEAD_CHANGED");
    return null;
  }
  function deny(message: string): never { throw new SOVDiscoverySupportError("REVIEW_REQUIRED", message); }
  if (execFileSync("git", ["status", "--porcelain=v1"], { cwd: repositoryPath, encoding: "utf8", windowsHide: true }).trim()) {
    deny("National supporting inspection selection requires committed source state");
  }
  const raw = new GitRawObjectPersistence({ repository_path: repositoryPath });
  const bundles = await raw.listVerifiedAcquisitions();
  const store = new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: repositoryPath, stream_id: streamId, scope: "PRODUCTION" });
  const discovery = createRawValidatedRestorationJournal(raw, store, source);
  const parser = new ChnenergySupportingEvidenceAdapter();
  const refs = new Map<string, ChnenergyRetainedReference>();
  for (const record of relevant) {
    if (refs.has(record.exact_url)) deny("National supporting inspection target is ambiguous");
    if (record.state !== "RECEIPT") deny("National supporting inspection remains unresolved");
    const claimIndex = replay.records.findIndex(candidate => candidate.state === "CLAIMED"
      && candidate.authorization.authorization_id === record.authorization.authorization_id);
    if (claimIndex < 0) deny("National supporting inspection claim is missing");
    const context = replay.resolve(record, claimIndex);
    for (const id of Object.values(record.bindings)) {
      const version = versions.find(candidate => candidate.artifact_id === id);
      if (!version || versions.filter(candidate => candidate.stream_id === version.stream_id
        && candidate.artifact.kind === version.artifact.kind).at(-1)?.artifact_id !== id) {
        deny("National supporting inspection source binding is no longer current");
      }
    }
    if (context.source.source_definition_id !== endpoint.source_definition_id
      || !parser.validateEndpoint(context.endpoint).valid) deny("National supporting inspection scope is invalid");
    const receipt = record.receipt;
    const matches = bundles.filter(bundle => bundle.acquisition_run.acquisition_run_id === receipt.acquisition_run_id);
    const bundle = matches[0];
    if (matches.length !== 1 || !bundle || canonicalHash(bundle) !== receipt.acquisition_bundle_hash
      || receipt.transport_status !== "SUCCESS" || receipt.exact_url !== record.exact_url
      || receipt.collection_run_id !== record.authorization.collection_run_id
      || receipt.acquisition_run_id !== `${receipt.collection_run_id}:acquisition:1`
      || bundle.snapshot.snapshot_id !== receipt.snapshot_id || bundle.snapshot.raw_blob_id !== receipt.raw_blob_id
      || !["SUCCESS", "FAILED"].includes(bundle.acquisition_run.status) || bundle.acquisition_run.request_metadata.locator !== record.exact_url
      || bundle.acquisition_run.started_at !== receipt.request_started_at || bundle.acquisition_run.completed_at !== receipt.response_received_at
      || bundle.acquisition_run.source_admission_artifact_id !== record.bindings.admission_artifact_id
      || bundle.acquisition_run.endpoint_artifact_id !== record.bindings.endpoint_artifact_id
      || bundle.acquisition_run.allowlist_artifact_id !== record.bindings.allowlist_artifact_id) {
      deny("National supporting receipt differs from its verified acquisition");
    }
    const ordinary = bundle.acquisition_run.status === "SUCCESS"
      && bundle.acquisition_run.result_metadata.extraction_status === "COMPLETE" && bundle.extracted_records.length === 1;
    const derivations = ordinary ? [] : (await raw.listVerifiedSupportingExtractionDerivations()).filter(value =>
      value.outcome === "COMPLETE" && value.original.acquisition_run_id === receipt.acquisition_run_id
      && value.original.acquisition_bundle_hash === receipt.acquisition_bundle_hash
      && value.original.snapshot_id === receipt.snapshot_id && value.extracted_records.length === 1);
    const retained = ordinary ? bundle.extracted_records[0] : derivations.length === 1 ? derivations[0]!.extracted_records[0] : undefined;
    if (!retained) deny("National supporting extraction has no unique independently verified record");
    const evidence = await discovery.readVerifiedDiscovery!(receipt.snapshot_id, retained.extracted_record_id);
    validateDiscoveryEvidence(evidence, "PRODUCTION");
    if (evidence.scope !== "PRODUCTION" || evidence.endpoint.locator !== record.exact_url
      || evidence.source_reference.source_definition.artifact_id !== record.bindings.source_artifact_id
      || evidence.source_reference.endpoint.artifact_id !== record.bindings.endpoint_artifact_id
      || evidence.source_reference.admission.artifact_id !== record.bindings.admission_artifact_id
      || evidence.source_reference.allowlist.artifact_id !== record.bindings.allowlist_artifact_id
      || canonicalSerialize(evidence.endpoint) !== canonicalSerialize(context.endpoint)
      || evidence.endpoint.adapter_key !== CHNENERGY_SUPPORT_ADAPTER_KEY
      || evidence.extracted_record.adapter_metadata[CHNENERGY_SUPPORT_ADAPTER_KEY]?.source_role !== "PACKAGE"
      || evidence.extracted_record.recruitment_context !== undefined) deny("National supporting evidence scope differs from its claim");
    let emitted;
    try {
      const extractionParser = evidence.extraction_derivation
        ? new ChnenergySupportingEvidenceAdapter("1.1.0") : parser;
      emitted = extractionParser.extract({ endpoint: evidence.endpoint, snapshot: evidence.snapshot,
        raw_blob: { raw_blob_id: evidence.snapshot.raw_blob_id!, bytes: evidence.raw_blob.bytes,
          raw_content_sha256: evidence.snapshot.content_hash!, byte_length: evidence.raw_blob.byte_length,
          mime_type: evidence.raw_blob.content_type, created_at: evidence.snapshot.observed_at } });
    } catch (error) {
      if (!(error instanceof AdapterExtractionError)) throw error;
      deny("National supporting parser rejected retained Raw");
    }
    if (!emitted || emitted.length !== 1) deny("National supporting record is ambiguous");
    const { extracted_record_id, snapshot_id, ...fields } = emitted[0]!;
    const canonical = createExtractedRecordV2(evidence.snapshot, { ...fields,
      extraction: { ...fields.extraction, schema_version: `${CHNENERGY_SUPPORT_ADAPTER_KEY}-extracted-record/2.0.0` } });
    if (canonicalSerialize(canonical) !== canonicalSerialize(evidence.extracted_record)) deny("National supporting record differs from retained Raw");
    refs.set(record.exact_url, { snapshot_id: evidence.snapshot.snapshot_id,
      extracted_record_id: evidence.extracted_record.extracted_record_id, raw_sha256: evidence.snapshot.content_hash! });
  }
  if (head() !== pinned) throw new Error("NATIONAL_SUPPORTING_HEAD_CHANGED");
  if (refs.size !== urls.length) deny("National supporting inspection dependency is missing");
  return new Chnenergy2027CampaignHtmlAdapter({ campaign: refs.get(CHNENERGY_CAMPAIGN_URL)!, membership: refs.get(job.membership_url)! });
}
