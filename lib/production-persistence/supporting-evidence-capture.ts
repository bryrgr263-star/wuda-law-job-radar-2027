import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { CollectionRunner } from "../collection-runtime/collection-runner";
import { InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService } from "../ingestion";
import { createExtractedRecordV2 } from "../ingestion/normalization/extracted-record-identity";
import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { ChnenergySupportingEvidenceAdapter } from "../production-sources/chnenergy-supporting-evidence";
import { executeSupportingInspectionRequest } from "./continuous-request-gate";
import { createSourcePersistenceVersion, type AcquisitionPersistenceBundle, type SourcePersistenceVersion } from "./contracts";
import { GitRawObjectPersistence } from "./git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "./git-source-registry-persistence";
import { ProductionRawObjectBoundary } from "./raw-object-boundary";
import { supportingInspectionReplay } from "./source-inspection-replay";
import type { SupportingInspectionPublicationOptions } from "./supporting-inspection-publisher";

export async function captureSupportingEvidence(input: SupportingInspectionPublicationOptions & {
  readonly collection_run_id: string;
  readonly source_versions: readonly SourcePersistenceVersion[];
}) {
  const options = structuredClone(input);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: options.repository_path,
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const clean = () => { if (git("status", "--porcelain=v1")) throw new Error("SUPPORT_CAPTURE_DIRTY_DENIED"); };
  const initial = new GitSourceRegistryPersistence({ repository_path: options.repository_path });
  initial.assertAuthoritativeHead(options.branch, options.expected_parent);
  const versions = await initial.listVersions();
  if (canonicalSerialize(versions) !== canonicalSerialize(options.source_versions)) throw new Error("SUPPORT_CAPTURE_SOURCE_VERSIONS_DENIED");
  const claim = options.claim;
  if (claim.artifact.kind !== "SUPPORTING_INSPECTION_EXECUTION" || claim.artifact.payload.state !== "CLAIMED") {
    throw new Error("SUPPORT_CAPTURE_NEW_CLAIM_REQUIRED");
  }
  const record = claim.artifact.payload;
  const proposed = supportingInspectionReplay([...versions, claim]);
  const context = proposed.resolve(record, proposed.records.length - 1);
  const adapter = new ChnenergySupportingEvidenceAdapter();
  if (!adapter.validateEndpoint(context.endpoint).valid || context.endpoint.collection_config.max_items !== 1) {
    throw new Error("SUPPORT_CAPTURE_FIXED_ADAPTER_DENIED");
  }
  clean();
  let claimHead: string | undefined;
  let sent = false;
  const runner = new CollectionRunner({
    transport: { async execute(request) {
      if (sent) throw new Error("SUPPORT_CAPTURE_REQUEST_BUDGET_DENIED");
      sent = true;
      const result = await executeSupportingInspectionRequest(options, request);
      claimHead = result.committed_claim_head;
      return result.response;
    } },
    raw_capture: new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository()),
    policy: { timeout_ms: 20000, retry_limit: 0, retry_backoff_ms: 0, rate_limit_ms: 0, max_pages: 1, request_budget: 1 }
  });
  const collection = await runner.run({ collection_run_id: options.collection_run_id, endpoint: context.endpoint,
    adapter, pagination_safety: { approved_locators: [record.exact_url], maximum_pages: 1, request_budget: 1 } });
  if (!claimHead || collection.request_results.length !== 1 || collection.requests_made !== 1) throw new Error("SUPPORT_CAPTURE_ACTUAL_RESPONSE_REQUIRED");
  const result = collection.request_results[0]!;
  const { request, response, snapshot, raw_blob: rawBlob } = result;
  const extracted = collection.extracted_records.map(value => {
    const { extracted_record_id, snapshot_id, ...fields } = value;
    return createExtractedRecordV2(snapshot, { ...fields, extraction: { ...value.extraction,
      schema_version: `${adapter.descriptor.adapter_key}-extracted-record/2.0.0` } });
  });
  const acquisitionId = `${options.collection_run_id}:acquisition:1`;
  const bundle: Omit<AcquisitionPersistenceBundle, "raw_blob_manifest"> = {
    acquisition_run: { acquisition_run_id: acquisitionId,
      source_admission_artifact_id: record.bindings.admission_artifact_id,
      endpoint_artifact_id: record.bindings.endpoint_artifact_id, allowlist_artifact_id: record.bindings.allowlist_artifact_id,
      status: response.status, started_at: request.requested_at, completed_at: response.responded_at,
      request_metadata: { locator: request.locator, method: request.method, parameters: request.parameters },
      result_metadata: { transport_status: response.status, extraction_status: collection.status === "SUCCESS" ? "COMPLETE" : collection.status,
        extracted_record_count: extracted.length }, provenance: claim.provenance },
    snapshot, extracted_records: extracted
  };
  new GitSourceRegistryPersistence({ repository_path: options.repository_path }).assertAuthoritativeHead(options.branch, claimHead);
  clean();
  const raw = new GitRawObjectPersistence({ repository_path: options.repository_path, remote: { name: "origin", branch: options.branch } });
  const boundary = new ProductionRawObjectBoundary(raw, raw);
  let expectedBundle: AcquisitionPersistenceBundle;
  if (rawBlob) {
    const prior = await raw.getRawBlobManifest(rawBlob.raw_blob_id);
    if (prior) {
      const original = await boundary.readVerified(rawBlob.raw_blob_id);
      if (prior.source_definition_id !== context.endpoint.source_definition_id || prior.recruitment_endpoint_id !== context.endpoint.recruitment_endpoint_id
        || prior.content_type !== rawBlob.mime_type || !Buffer.from(original.bytes).equals(Buffer.from(rawBlob.bytes))) {
        throw new Error("SUPPORT_CAPTURE_RAW_REUSE_DENIED");
      }
      expectedBundle = { ...bundle, raw_blob_manifest: prior };
      await raw.appendAcquisitionBundle(expectedBundle);
    } else {
      const stored = await boundary.persistSuccessfulAcquisition({ raw_blob: rawBlob, source_definition_id: context.endpoint.source_definition_id,
        recruitment_endpoint_id: context.endpoint.recruitment_endpoint_id, acquired_at: response.responded_at, provenance: claim.provenance, bundle });
      expectedBundle = { ...bundle, raw_blob_manifest: stored.manifest };
    }
  } else {
    expectedBundle = { ...bundle, raw_blob_manifest: null };
    await boundary.persistFailedAcquisition(bundle);
  }
  const rawHead = git("rev-parse", "HEAD");
  if (git("rev-parse", `${rawHead}^`) !== claimHead) throw new Error("SUPPORT_CAPTURE_RAW_LINEAGE_DENIED");
  const source = new GitSourceRegistryPersistence({ repository_path: options.repository_path });
  source.assertAuthoritativeHead(options.branch, rawHead);
  clean();
  const freshRaw = new GitRawObjectPersistence({ repository_path: options.repository_path });
  const acquisitions = await freshRaw.listVerifiedAcquisitions();
  const matches = acquisitions.filter(value => value.acquisition_run.acquisition_run_id === acquisitionId);
  if (matches.length !== 1 || canonicalSerialize(matches[0]) !== canonicalSerialize(expectedBundle)) throw new Error("SUPPORT_CAPTURE_RAW_READBACK_DENIED");
  if (rawBlob) {
    const verified = await new ProductionRawObjectBoundary(freshRaw, freshRaw).readVerified(rawBlob.raw_blob_id);
    if (!Buffer.from(verified.bytes).equals(Buffer.from(rawBlob.bytes))) throw new Error("SUPPORT_CAPTURE_RAW_READBACK_DENIED");
  }
  const currentVersions = await source.listVersions();
  if (canonicalSerialize(currentVersions) !== canonicalSerialize([...versions, claim])) throw new Error("SUPPORT_CAPTURE_CLAIM_READBACK_DENIED");
  const replay = supportingInspectionReplay(currentVersions);
  if (canonicalSerialize(replay.current.find(value => value.authorization.authorization_id === record.authorization.authorization_id))
    !== canonicalSerialize(record)) throw new Error("SUPPORT_CAPTURE_UNRESOLVED_CLAIM_REQUIRED");
  source.assertAuthoritativeHead(options.branch, rawHead);
  const receipt = { ...record, state: "RECEIPT" as const, receipt: {
    collection_run_id: options.collection_run_id, exact_url: request.locator, acquisition_run_id: acquisitionId,
    snapshot_id: snapshot.snapshot_id, acquisition_bundle_hash: canonicalHash(matches[0]),
    request_started_at: request.requested_at, response_received_at: response.responded_at,
    transport_status: response.status, raw_blob_id: rawBlob?.raw_blob_id ?? null
  } };
  const at = new Date().toISOString();
  const terminal = createSourcePersistenceVersion({ stream_id: claim.stream_id, revision: claim.revision + 1,
    supersedes_artifact_id: claim.artifact_id, artifact: { kind: "SUPPORTING_INSPECTION_EXECUTION", payload: receipt },
    provenance: claim.provenance, effective_at: at, created_at: at });
  clean();
  source.assertAuthoritativeHead(options.branch, rawHead);
  if (await source.appendVersion(terminal) !== "APPENDED") throw new Error("SUPPORT_CAPTURE_TERMINAL_REUSE_DENIED");
  if (git("rev-parse", "HEAD") !== rawHead) throw new Error("SUPPORT_CAPTURE_TERMINAL_PARENT_DENIED");
  git("add", "--", "production-source-state");
  if (git("diff", "--cached", "--name-only").split(/\r?\n/u).some(file => !file.startsWith("production-source-state/"))) {
    throw new Error("SUPPORT_CAPTURE_UNRELATED_STAGE_DENIED");
  }
  git("-c", `user.name=${options.commit_identity.name}`, "-c", `user.email=${options.commit_identity.email}`, "commit", "-m",
    `Supporting inspection RECEIPT ${terminal.artifact_id} publication ${randomUUID()}`);
  const receiptHead = git("rev-parse", "HEAD");
  if (git("rev-parse", `${receiptHead}^`) !== rawHead
    || git("ls-remote", "--heads", "origin", `refs/heads/${options.branch}`).split(/\s+/u)[0] !== rawHead) {
    throw new Error("SUPPORT_CAPTURE_TERMINAL_CAS_DENIED");
  }
  git("push", "origin", `${receiptHead}:refs/heads/${options.branch}`);
  const readback = new GitSourceRegistryPersistence({ repository_path: options.repository_path });
  readback.assertAuthoritativeHead(options.branch, receiptHead);
  if (canonicalSerialize(await readback.listVersions()) !== canonicalSerialize([...currentVersions, terminal])) throw new Error("SUPPORT_CAPTURE_TERMINAL_READBACK_DENIED");
  const finalRaw = await new GitRawObjectPersistence({ repository_path: options.repository_path }).listVerifiedAcquisitions();
  if (canonicalSerialize(finalRaw) !== canonicalSerialize(acquisitions)) throw new Error("SUPPORT_CAPTURE_FINAL_RAW_DENIED");
  clean();
  readback.assertAuthoritativeHead(options.branch, receiptHead);
  return { claim_head: claimHead, raw_head: rawHead, receipt_head: receiptHead, snapshot_id: snapshot.snapshot_id,
    acquisition_bundle_hash: canonicalHash(matches[0]), transport_status: response.status,
    extraction_status: bundle.acquisition_run.result_metadata.extraction_status, extracted_record_ids: extracted.map(value => value.extracted_record_id) };
}
