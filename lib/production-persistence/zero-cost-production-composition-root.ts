import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  InMemorySourceAdmissionRegister,
  evaluateSourceAutomationPermission
} from "../application/source-admission";
import {
  CollectionRunner,
  type HttpTransportRequest
} from "../collection-runtime";
import {
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  InMemorySourceRegistry,
  RawCaptureService,
  bootstrapTrustedChainCompositionRoot,
  createExtractedRecordV2,
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION,
  type ExtractedRecord,
  type ExtractedRecordV2,
  type IsoDateTime,
  type PresentationReadModel,
  type RecruitmentAdapter,
  type Snapshot,
  type TransportResponse,
  type TrustedChainCommand,
  type TrustedChainCompositionRoot,
  type TrustedChainExecutionMetadata,
  type TrustedCandidateEvidenceSourceVerifier
} from "../ingestion";
import {
  canonicalDeserialize,
  canonicalHash,
  canonicalSerialize
} from "../ingestion/normalization/canonical-artifact-registry";
import {
  assertOfficialRequestAllowed,
  type AcquisitionPersistenceBundle,
  type ProductionPersistenceProvenance,
  type SourcePersistenceVersion
} from "./contracts";
import { GitAppendOnlyExecutionStore } from "./git-append-only-execution-store";
import {
  GitRawObjectPersistence,
  createRawValidatedRestorationJournal
} from "./git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "./git-source-registry-persistence";
import { ProductionRawObjectBoundary } from "./raw-object-boundary";
import { rehydrateProductionSourceOwners } from "./source-owner-rehydration";
import { resolveContinuousSourceContext } from "./continuous-source-context";
import { executeContinuousRequest } from "./continuous-request-gate";
import { pendingContinuousAttempt, type ContinuousRecord, type ContinuousScope, type ContinuousFencingVerifier } from "../application/source-admission/continuous-acquisition";

const RUN_SCHEMA_VERSION = "zero-cost-production-run/1.0.0" as const;
const activeWriters = new Set<string>();

export type ZeroCostProductionRunStatus =
  | "CREATED"
  | "RUNNING"
  | "VALIDATING"
  | "COMMITTING"
  | "COMMITTED"
  | "FAILED"
  | "EVIDENCE_BLOCKED"
  | "PARTIAL";

export type ZeroCostProductionFaultPoint =
  | "AFTER_CONTINUOUS_RESERVATION"
  | "AFTER_ACQUISITION"
  | "BEFORE_ATOMIC_COMMIT"
  | "AFTER_LOCAL_COMMIT"
  | "AFTER_PUSH"
  | "BEFORE_PRESENTATION_PUBLISH";

export interface ZeroCostProductionRunEvent {
  readonly status: ZeroCostProductionRunStatus;
  readonly at: string;
  readonly detail: string;
}

export interface ZeroCostProductionRunResult {
  readonly run_id: string;
  readonly status: ZeroCostProductionRunStatus;
  readonly lifecycle: readonly ZeroCostProductionRunEvent[];
  readonly expected_parent: string | null;
  readonly committed_head: string | null;
  readonly raw_blob_ids: readonly string[];
  readonly snapshot_ids: readonly string[];
  readonly extracted_record_ids: readonly string[];
  readonly restoration_record_ids: readonly string[];
  readonly presentation_read_model_ids: readonly string[];
  readonly presentation_publish_status: "NOT_REQUESTED" | "PUBLISHED" | "RETRY_REQUIRED";
  readonly error: string | null;
}

export interface ZeroCostProductionAcquisitionTransport {
  execute(request: HttpTransportRequest): Promise<TransportResponse>;
}

export interface ZeroCostProductionTrustedRunContext {
  readonly source_occurrences: readonly unknown[];
  readonly snapshots: readonly Snapshot[];
  readonly extracted_records: readonly ExtractedRecordV2[];
  readonly resolvers: TrustedChainCompositionRoot["resolvers"];
  execute(command: TrustedChainCommand): Promise<unknown>;
}

export interface ZeroCostProductionRunInput {
  readonly continuous_authorization_ids?: readonly string[];
  readonly run_id: string;
  readonly source_versions: readonly SourcePersistenceVersion[];
  readonly source_admission_id: string;
  readonly recruitment_endpoint_id: string;
  readonly adapter: RecruitmentAdapter;
  readonly transport: ZeroCostProductionAcquisitionTransport;
  readonly provenance: ProductionPersistenceProvenance;
  readonly actor: string;
  readonly started_at: string;
  readonly execute_trusted_chain: (
    context: ZeroCostProductionTrustedRunContext
  ) => Promise<void>;
  readonly source_role_for_record?: (
    record: ExtractedRecordV2
  ) => "POSITION_BEARING" | "PACKAGE";
  readonly publish_presentation?: (
    readModels: readonly PresentationReadModel[]
  ) => Promise<void>;
  readonly candidate_evidence_source_verifier?: TrustedCandidateEvidenceSourceVerifier;
}

export interface ZeroCostProductionCompositionRootOptions {
  readonly continuous_scope?: ContinuousScope;
  readonly continuous_fencing_verifier?: ContinuousFencingVerifier;
  readonly controlled_continuous_transport?: ZeroCostProductionAcquisitionTransport;
  readonly remote_url: string;
  readonly branch: string;
  readonly stream_id: string;
  readonly commit_identity?: { readonly name: string; readonly email: string };
  readonly now?: () => string;
  readonly fault_injector?: (
    point: ZeroCostProductionFaultPoint
  ) => void | Promise<void>;
}

export interface ZeroCostProductionRestoreResult {
  readonly continuous_records: readonly ContinuousRecord[];
  readonly continuous_authorizations: readonly ReturnType<InMemorySourceAdmissionRegister["resolveContinuousAuthorization"]>[];
  readonly committed_head: string;
  readonly source_version_count: number;
  readonly acquisition_count: number;
  readonly restored_record_count: number;
  readonly restoration_record_ids: readonly string[];
  readonly artifact_seals: readonly {
    readonly artifact_kind: string;
    readonly artifact_id: string;
    readonly content_hash: string;
  }[];
  readonly presentation_decisions: readonly import("../ingestion").PresentationDecision[];
  readonly read_models: readonly PresentationReadModel[];
  readonly historical_read_models: readonly PresentationReadModel[];
  readonly current_snapshot: import("../ingestion").PresentationCurrentSnapshot | null;
  readonly runs: readonly ZeroCostCommittedRunManifest[];
}

export interface ZeroCostCommittedRunManifest {
  readonly schema_version: typeof RUN_SCHEMA_VERSION;
  readonly run_id: string;
  readonly status: "COMMITTED";
  readonly lifecycle: readonly ZeroCostProductionRunEvent[];
  readonly expected_parent: string;
  readonly source_version_ids: readonly string[];
  readonly acquisition_run_ids: readonly string[];
  readonly raw_blob_ids: readonly string[];
  readonly snapshot_ids: readonly string[];
  readonly extracted_record_ids: readonly string[];
  readonly restoration_record_ids: readonly string[];
  readonly presentation_read_model_ids: readonly string[];
  readonly presentation_read_model_hashes: readonly string[];
  readonly retained_outcome_references?: readonly {
    readonly artifact_kind: "PRESENTATION_DECISION" | "PRESENTATION_MIGRATION_AUDIT";
    readonly artifact_id: string;
    readonly integrity_hash: string;
  }[];
  readonly retained_read_model_ids?: readonly string[];
  readonly retained_read_model_hashes?: readonly string[];
  readonly integrity_hash: string;
}

export function bootstrapZeroCostProductionCompositionRoot(
  options: ZeroCostProductionCompositionRootOptions
) {
  const remoteUrl = required(options.remote_url, "remote_url");
  const branch = required(options.branch, "branch");
  const streamId = required(options.stream_id, "stream_id");
  const writerKey = `${remoteUrl}\0${branch}`;
  const now = options.now ?? (() => new Date().toISOString());
  const commitIdentity = options.commit_identity ?? {
    name: "Zero Cost Production Root",
    email: "zero-cost-production@invalid.local"
  };
  let running = false;
  const continuousScope = options.continuous_scope ?? "PRODUCTION";
  if (options.controlled_continuous_transport && continuousScope !== "CONTROLLED_TEST") {
    throw new Error("CONTROLLED_TRANSPORT_NOT_ALLOWED");
  }

  async function control(command: (owner: InMemorySourceAdmissionRegister, versions: readonly SourcePersistenceVersion[]) => ContinuousRecord) {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "source-control-"));
    const checkoutPath = path.join(temporaryRoot, "checkout");
    try {
      cloneRemote(remoteUrl, branch, checkoutPath);
      const repository = new GitSourceRegistryPersistence({ repository_path: checkoutPath, fencing_verifier: options.continuous_fencing_verifier });
      const owner = new InMemorySourceAdmissionRegister();
      await rehydrateProductionSourceOwners({ repository, source_registry: new InMemorySourceRegistry(),
        source_admission_register: owner, continuous_records: repository.listContinuousRecords(), fencing_verifier: options.continuous_fencing_verifier });
      const parent = repository.readCommittedHead();
      repository.assertAuthoritativeHead(branch, parent);
      const record = command(owner, await repository.listVersions());
      const grant = record.payload.grant ?? owner.resolveContinuousAuthorization(record.payload.authorization_id
        ?? pendingContinuousAttempt(owner.listContinuousRecords())?.payload.authorization_id ?? "").grant;
      if (grant.canonical_payload.scope !== continuousScope) throw new Error("AUTHORIZATION_SCOPE_MISMATCH");
      const committedHead = await repository.publishContinuousRecord(record, { expected_parent: parent, branch, commit_identity: commitIdentity });
      return { committed_head: committedHead, record: structuredClone(record) };
    } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
  }

  const root = Object.freeze({
    async issueContinuousAuthorization(input: { readonly allowlist_entry_id: string; readonly effective_from: string; readonly min_interval_seconds: number; readonly actor: string }) {
      return control((owner, versions) => owner.issueContinuousAuthorization(resolveContinuousSourceContext(versions, input.allowlist_entry_id), {
        effective_from: input.effective_from, min_interval_seconds: input.min_interval_seconds, actor: input.actor, issued_at: now() }));
    },

    async revokeContinuousAuthorization(input: { readonly authorization_id: string; readonly actor: string; readonly reference: string }) {
      return control(owner => owner.revokeContinuousAuthorization(input.authorization_id, input.actor, now(), input.reference));
    },

    async recoverContinuousAttempt(input: { readonly attempt_id: string; readonly fencing_evidence: Readonly<Record<string, unknown>> }) {
      return control(owner => {
        const pending = pendingContinuousAttempt(owner.listContinuousRecords());
        if (!pending || pending.payload.attempt_id !== input.attempt_id) throw new Error("PENDING_ATTEMPT_MISSING");
        return owner.closeContinuousAttempt(input.attempt_id, pending.payload.holder!, now(), "FENCED_UNKNOWN", input.fencing_evidence, options.continuous_fencing_verifier);
      });
    },

    async run(input: ZeroCostProductionRunInput): Promise<ZeroCostProductionRunResult> {
      if (running || activeWriters.has(writerKey)) {
        return emptyResult(input.run_id, "FAILED", [event(
          "FAILED", now(), "A production writer is already active"
        )], "Single-writer boundary rejected a concurrent run");
      }
      running = true;
      activeWriters.add(writerKey);
      const lifecycle: ZeroCostProductionRunEvent[] = [
        event("CREATED", input.started_at, "Production run created"),
        event("RUNNING", now(), "Fresh Process A started")
      ];
      const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "zero-cost-production-"));
      const checkoutPath = path.join(temporaryRoot, "checkout");
      let expectedParent: string | null = null;
      let committedHead: string | null = null;
      let pushed = false;
      let rawBlobIds: string[] = [];
      let snapshotIds: string[] = [];
      let extractedRecordIds: string[] = [];
      let restorationRecordIds: string[] = [];
      let readModels: PresentationReadModel[] = [];
      const retainedModels: PresentationReadModel[] = [];
      const retainedOutcomes: NonNullable<ZeroCostCommittedRunManifest["retained_outcome_references"]>[number][] = [];
      try {
        cloneRemote(remoteUrl, branch, checkoutPath);
        expectedParent = git(checkoutPath, "rev-parse", "HEAD").trim();
        const sourceRepository = new GitSourceRegistryPersistence({
          repository_path: checkoutPath, fencing_verifier: options.continuous_fencing_verifier
        });
        if (input.continuous_authorization_ids?.length && input.source_versions.length) throw new Error("CONTINUOUS_EXECUTION_REQUIRES_COMMITTED_SOURCE_STATE");
        for (const version of input.source_versions) {
          await sourceRepository.appendVersion(version);
        }
        const sourceRegistry = new InMemorySourceRegistry();
        const admissionRegister = new InMemorySourceAdmissionRegister();
        await rehydrateProductionSourceOwners({
          repository: sourceRepository,
          source_registry: sourceRegistry,
          source_admission_register: admissionRegister,
          continuous_records: sourceRepository.listContinuousRecords(), fencing_verifier: options.continuous_fencing_verifier
        });
        const endpoint = sourceRegistry.getRecruitmentEndpoint(
          input.recruitment_endpoint_id as never
        );
        const admission = admissionRegister.get(input.source_admission_id as never);
        const permission = evaluateSourceAutomationPermission(admission);
        if (!permission.allowed) throw new Error("Source Admission does not allow collection");
        const continuous = permission.mode === "REVOCABLE_CONTINUOUS_UNATTENDED_ACQUISITION" || !!input.continuous_authorization_ids?.length;
        if (continuous && (!input.continuous_authorization_ids?.length || input.source_versions.length)) {
          throw new Error("CONTINUOUS_AUTHORIZATION_REFERENCE_AND_COMMITTED_SOURCE_STATE_REQUIRED");
        }
        const sourceVersions = continuous ? await sourceRepository.listVersions() : input.source_versions;
        if (admission.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id) {
          throw new Error("Source Admission endpoint binding mismatch");
        }
        const registration = sourceRegistry.resolveAdapterForEndpoint(
          endpoint.recruitment_endpoint_id
        );
        if (registration.adapter_key !== input.adapter.descriptor.adapter_key) {
          throw new Error("Injected adapter does not match Source Registry");
        }
        const validation = input.adapter.validateEndpoint(endpoint);
        if (!validation.valid) throw new Error(validation.issues.join("; "));
        const endpointVersion = currentVersion(sourceVersions, "RECRUITMENT_ENDPOINT",
          endpoint.recruitment_endpoint_id);
        const admissionVersion = currentVersion(sourceVersions, "SOURCE_ADMISSION",
          admission.source_admission_id);
        const allowlistVersions = sourceVersions.filter((version) => {
          return version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST"
            && version.artifact.payload.recruitment_endpoint_artifact_id
              === endpointVersion.artifact_id
            && version.artifact.payload.source_admission_artifact_id
              === admissionVersion.artifact_id;
        });
        if (allowlistVersions.length === 0) {
          throw new Error("Approved official endpoint allowlist is unavailable");
        }

        const rawPersistence = new GitRawObjectPersistence({
          repository_path: checkoutPath
        });
        const rawBoundary = new ProductionRawObjectBoundary(
          rawPersistence,
          rawPersistence
        );
        const rawRepository = new InMemoryRawBlobRepository();
        const snapshotRepository = new InMemorySnapshotRepository();
        let snapshotSequence = 0;
        const capture = new RawCaptureService(rawRepository, snapshotRepository, {
          create_snapshot_id: () => {
            snapshotSequence += 1;
            return `${input.run_id}:snapshot:${snapshotSequence}` as never;
          }
        });
        const allowlistFor = (request: Pick<HttpTransportRequest, "locator" | "method">) => {
          const match = allowlistVersions.find((version) => {
            if (version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") return false;
            try {
              assertOfficialRequestAllowed(
                version.artifact.payload,
                request.locator,
                request.method ?? endpoint.request_method ?? "GET"
              );
              return true;
            } catch {
              return false;
            }
          });
          if (!match || match.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") {
            throw new Error(`Approved official endpoint allowlist is unavailable: ${request.locator}`);
          }
          return match;
        };
        const collection = await new CollectionRunner({
          transport: {
            execute: async (request: HttpTransportRequest) => {
              allowlistFor(request);
              if (continuous) {
                const execution = await executeContinuousRequest({ repository_path: checkoutPath, branch,
                  authorization_ids: input.continuous_authorization_ids!, source_admission_id: input.source_admission_id,
                  recruitment_endpoint_id: input.recruitment_endpoint_id, scope: continuousScope, commit_identity: commitIdentity,
                  now, fencing_verifier: options.continuous_fencing_verifier, controlled_transport: options.controlled_continuous_transport,
                  after_reservation: () => options.fault_injector?.("AFTER_CONTINUOUS_RESERVATION") }, request);
                expectedParent = execution.committed_head;
                return execution.response;
              }
              return input.transport.execute(request);
            }
          },
          raw_capture: capture,
          policy: {
            timeout_ms: endpoint.collection_config.timeout_ms ?? 20_000,
            retry_limit: endpoint.collection_config.retry_limit ?? 0,
            retry_backoff_ms: 0,
            rate_limit_ms: 0,
            max_pages: endpoint.collection_config.max_pages ?? 1,
            request_budget: (endpoint.collection_config.max_pages ?? 1)
              * ((endpoint.collection_config.retry_limit ?? 0) + 1)
          },
          clock: {
            now: () => now() as IsoDateTime,
            now_ms: () => Date.now(),
            sleep: async () => undefined
          }
        }).run({
          collection_run_id: input.run_id,
          endpoint,
          adapter: input.adapter
        });
        const snapshots = [...collection.snapshots];
        const snapshotById = new Map(snapshots.map((snapshot) => {
          return [snapshot.snapshot_id, snapshot] as const;
        }));
        const extractedRecords = collection.extracted_records.map((record) => {
          const snapshot = snapshotById.get(record.snapshot_id);
          if (!snapshot) throw new Error("ExtractedRecord Snapshot is unavailable");
          return toExtractedRecordV2(snapshot, record, input.adapter);
        });
        for (let index = 0; index < collection.request_results.length; index += 1) {
          const requestResult = collection.request_results[index]!;
          const { request, response, snapshot, raw_blob: rawBlob } = requestResult;
          const records = extractedRecords.filter((record) => {
            return record.snapshot_id === snapshot.snapshot_id;
          });
          const allowlistVersion = allowlistFor(request);
          const acquisitionRunId = `${input.run_id}:acquisition:${index + 1}`;
          const bundle: Omit<AcquisitionPersistenceBundle, "raw_blob_manifest"> = {
            acquisition_run: {
              acquisition_run_id: acquisitionRunId,
              source_admission_artifact_id: admissionVersion.artifact_id,
              endpoint_artifact_id: endpointVersion.artifact_id,
              allowlist_artifact_id: allowlistVersion.artifact_id,
              status: response.status === "SUCCESS" ? "SUCCESS" : "FAILED",
              started_at: request.requested_at,
              completed_at: response.responded_at,
              request_metadata: {
                locator: request.locator,
                method: request.method,
                parameters: request.parameters
              },
              result_metadata: {
                transport_status: response.status,
                extraction_status: collection.status === "SUCCESS" ? "COMPLETE" : collection.status,
                extracted_record_count: records.length
              },
              provenance: input.provenance
            },
            snapshot,
            extracted_records: records
          };
          if (rawBlob) {
            const originalManifest = await rawPersistence.getRawBlobManifest(rawBlob.raw_blob_id);
            if (originalManifest) {
              const originalRaw = await rawBoundary.readVerified(rawBlob.raw_blob_id);
              if (originalManifest.source_definition_id !== endpoint.source_definition_id
                  || originalManifest.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
                  || originalManifest.raw_content_sha256 !== rawBlob.raw_content_sha256
                  || originalManifest.byte_length !== rawBlob.byte_length
                  || originalManifest.content_type !== rawBlob.mime_type
                  || !Buffer.from(originalRaw.bytes).equals(Buffer.from(rawBlob.bytes))) {
                throw new Error("EVIDENCE_BLOCKED: Raw manifest reuse requires exact original source and bytes");
              }
              await rawPersistence.appendAcquisitionBundle({ ...bundle, raw_blob_manifest: originalManifest });
            } else {
              await rawBoundary.persistSuccessfulAcquisition({
                raw_blob: rawBlob,
                source_definition_id: endpoint.source_definition_id,
                recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
                acquired_at: response.responded_at,
                provenance: input.provenance,
                bundle
              });
            }
            rawBlobIds.push(rawBlob.raw_blob_id);
          } else {
            await rawBoundary.persistFailedAcquisition(bundle);
          }
        }
        snapshotIds = snapshots.map((snapshot) => snapshot.snapshot_id);
        extractedRecordIds = extractedRecords.map((record) => record.extracted_record_id);
        await options.fault_injector?.("AFTER_ACQUISITION");
        if (collection.status !== "SUCCESS") {
          const status = collection.status === "PARTIAL" ? "PARTIAL"
            : collection.status === "SUSPICIOUS_EMPTY" ? "EVIDENCE_BLOCKED"
              : "FAILED";
          lifecycle.push(event(status, now(), collection.reason_codes.join(",")));
          return result(input.run_id, status, lifecycle, expectedParent, null, {
            rawBlobIds, snapshotIds, extractedRecordIds,
            error: collection.reason_codes.join(",")
          });
        }

        const journalStore = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
          repository_path: checkoutPath,
          stream_id: streamId,
          scope: "PRODUCTION",
          commit_identity: commitIdentity
        });
        const trusted = await bootstrapTrustedChainCompositionRoot({
          scope: "PRODUCTION",
          anchored_history_head: expectedParent,
          restoration_journal: createRawValidatedRestorationJournal(
            rawPersistence,
            journalStore,
            sourceRepository
          ),
          candidate_evidence_source_verifier:
            input.candidate_evidence_source_verifier
        });
        const metadata: TrustedChainExecutionMetadata = {
          actor: input.actor,
          recorded_at: now()
        };
        const sourceOccurrences: unknown[] = [];
        for (const record of extractedRecords) {
          const snapshot = snapshots.find((candidate) => {
            return candidate.snapshot_id === record.snapshot_id;
          });
          if (!snapshot) throw new Error("ExtractedRecord Snapshot is unavailable");
          const sourceInput = {
            source_role: input.source_role_for_record?.(record) ?? "POSITION_BEARING" as const,
            endpoint, snapshot, extracted_record: record
          };
          const current = trusted.root.resolvers.source_occurrences.resolveForDiscovery(sourceInput);
          const proposal = current && materializeSourceOccurrenceVersion({
            prepared: prepareSourceOccurrenceMaterialization(endpoint, record, snapshot),
            existing_occurrence: current.occurrence, existing_versions: [current.version]
          });
          if (current && proposal && !proposal.version_created
              && (current.snapshot.snapshot_id !== snapshot.snapshot_id || current.extracted_record.extracted_record_id !== record.extracted_record_id)) {
            const verified = await trusted.root.execute({
              kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY",
              input: { schema_version: SOV_DISCOVERY_SUPPORT_SCHEMA_VERSION, sov_id: current.version.source_occurrence_version_id,
                snapshot_id: snapshot.snapshot_id, extracted_record_id: record.extracted_record_id, source_role: sourceInput.source_role }
            }, metadata) as { readonly support: { readonly support_id: string } };
            sourceOccurrences.push({ ...current, discovery_support_id: verified.support.support_id });
            continue;
          }
          sourceOccurrences.push(await trusted.root.execute({
            kind: "SOURCE_OCCURRENCE_MATERIALIZE",
            input: {
              source_role: input.source_role_for_record?.(record) ?? "POSITION_BEARING",
              endpoint,
              snapshot,
              extracted_record: record
            }
          }, metadata));
        }
        const execute = async (command: TrustedChainCommand) => {
          if (command.kind === "CANDIDATE_EVIDENCE_MATERIALIZE_SYNTHETIC") {
            throw new Error("SYNTHETIC_TEST Candidate Evidence is forbidden in production state");
          }
          const output = await trusted.root.execute(command, metadata);
          if (command.kind === "PRESENTATION_DECIDE") {
            const issued = output as { readonly decision?: import("../ingestion").PresentationDecision };
            if (issued.decision?.schema_version === "presentation-decision/2.0.0"
                && issued.decision.record_kind === "UNBOUND_RETAINED_OUTCOME") {
              retainedOutcomes.push({ artifact_kind: "PRESENTATION_DECISION",
                artifact_id: issued.decision.presentation_decision_id, integrity_hash: issued.decision.integrity_hash });
            }
          }
          if (command.kind === "PRESENTATION_MIGRATE_V1") {
            const migrated = output as { readonly audit: import("../ingestion").PresentationMigrationAudit;
              readonly read_model?: PresentationReadModel };
            if (migrated.audit.classification === "BLOCKED") retainedOutcomes.push({ artifact_kind: "PRESENTATION_MIGRATION_AUDIT",
              artifact_id: migrated.audit.migration_id, integrity_hash: migrated.audit.integrity_hash });
            else {
              if (!migrated.read_model) throw new Error("Equivalent Presentation migration did not produce its matching ReadModel");
              readModels.push(migrated.read_model);
            }
          }
          if (command.kind === "PRESENTATION_READ_MODEL_MATERIALIZE") {
            const readModel = readModelFrom(output);
            if (readModel.schema_version === "presentation-read-model/2.0.0" && readModel.record_kind === "UNBOUND_RETAINED_OUTCOME") retainedModels.push(readModel);
            else readModels.push(readModel);
          }
          return output;
        };
        await input.execute_trusted_chain(Object.freeze({
          source_occurrences: structuredClone(sourceOccurrences),
          snapshots: structuredClone(snapshots),
          extracted_records: structuredClone(extractedRecords),
          resolvers: trusted.root.resolvers,
          execute
        }));
        journalStore.readCurrentSnapshot();
        if (readModels.length === 0 && retainedOutcomes.length === 0) {
          throw new Error("Production run did not produce a PresentationReadModel or verified retained outcome");
        }
        lifecycle.push(event("VALIDATING", now(), "Trusted state is complete"));
        const executions = journalStore.listVerifiedExecutions();
        const acquisitions = await rawPersistence.listVerifiedAcquisitions();
        restorationRecordIds = executions.map((execution) => {
          return execution.record.restoration_record_id;
        });
        lifecycle.push(event("COMMITTING", now(), "Atomic Git commit is being prepared"));
        await options.fault_injector?.("BEFORE_ATOMIC_COMMIT");
        journalStore.prepareAtomicCommit(expectedParent);
        rawPersistence.prepareAtomicCommit(expectedParent);
        const committedLifecycle = [
          ...lifecycle,
          event("COMMITTED", now(), "Atomic state commit prepared")
        ];
        const runManifest = createRunManifest({
          run_id: input.run_id,
          lifecycle: committedLifecycle,
          expected_parent: expectedParent,
          source_version_ids: sourceVersions.map((version) => version.artifact_id),
          acquisition_run_ids: acquisitions.map((bundle) => {
            return bundle.acquisition_run.acquisition_run_id;
          }),
          raw_blob_ids: rawBlobIds,
          snapshot_ids: snapshotIds,
          extracted_record_ids: extractedRecordIds,
          restoration_record_ids: restorationRecordIds,
          presentation_read_model_ids: readModels.map((model) => {
            return model.presentation_read_model_id;
          }),
          presentation_read_model_hashes: readModels.map((model) => model.integrity_hash),
          retained_outcome_references: retainedOutcomes,
          retained_read_model_ids: retainedModels.map((model) => model.presentation_read_model_id),
          retained_read_model_hashes: retainedModels.map((model) => model.integrity_hash)
        });
        writeRunManifest(checkoutPath, runManifest);
        squashAndCommit(checkoutPath, expectedParent, input.run_id, commitIdentity);
        committedHead = git(checkoutPath, "rev-parse", "HEAD").trim();
        await options.fault_injector?.("AFTER_LOCAL_COMMIT");
        assertRemoteHead(remoteUrl, branch, expectedParent);
        git(checkoutPath, "push", "origin", `HEAD:refs/heads/${branch}`);
        if (remoteHead(remoteUrl, branch) !== committedHead) {
          throw new Error("Remote did not accept the atomic production commit");
        }
        pushed = true;
        lifecycle.splice(0, lifecycle.length, ...committedLifecycle);
        await options.fault_injector?.("AFTER_PUSH");
        if (input.publish_presentation) {
          try {
            await options.fault_injector?.("BEFORE_PRESENTATION_PUBLISH");
            const snapshot = journalStore.readCurrentSnapshot();
            if (!snapshot) throw new Error("Presentation V2 authoritative current repository is not activated");
            await input.publish_presentation(structuredClone(snapshot.current_position_read_models));
          } catch (error) {
            return result(input.run_id, "COMMITTED", lifecycle, expectedParent,
              committedHead, {
                rawBlobIds, snapshotIds, extractedRecordIds, restorationRecordIds,
                readModelIds: readModels.map((model) => model.presentation_read_model_id),
                publishStatus: "RETRY_REQUIRED",
                error: errorMessage(error)
              });
          }
        }
        return result(input.run_id, "COMMITTED", lifecycle, expectedParent, committedHead, {
          rawBlobIds, snapshotIds, extractedRecordIds, restorationRecordIds,
          readModelIds: readModels.map((model) => model.presentation_read_model_id),
          publishStatus: input.publish_presentation ? "PUBLISHED" : "NOT_REQUESTED"
        });
      } catch (error) {
        if (pushed) {
          lifecycle.push(event("COMMITTED", now(), "Trusted state remains committed"));
          return result(input.run_id, "COMMITTED", lifecycle, expectedParent,
            committedHead, {
              rawBlobIds, snapshotIds, extractedRecordIds, restorationRecordIds,
              readModelIds: readModels.map((model) => model.presentation_read_model_id),
              publishStatus: "RETRY_REQUIRED",
              error: errorMessage(error)
            });
        }
        const status = /EVIDENCE_BLOCKED/u.test(errorMessage(error))
          ? "EVIDENCE_BLOCKED" : "FAILED";
        lifecycle.push(event(status, now(), errorMessage(error)));
        return result(input.run_id, status, lifecycle, expectedParent, null, {
          rawBlobIds, snapshotIds, extractedRecordIds, restorationRecordIds,
          readModelIds: readModels.map((model) => model.presentation_read_model_id),
          error: errorMessage(error)
        });
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
        activeWriters.delete(writerKey);
        running = false;
      }
    },

    async restore(): Promise<ZeroCostProductionRestoreResult> {
      const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "zero-cost-restore-"));
      const checkoutPath = path.join(temporaryRoot, "checkout");
      try {
        cloneRemote(remoteUrl, branch, checkoutPath);
        const sourceRepository = new GitSourceRegistryPersistence({
          repository_path: checkoutPath, fencing_verifier: options.continuous_fencing_verifier
        });
        const sourceRegistry = new InMemorySourceRegistry();
        const admissionRegister = new InMemorySourceAdmissionRegister();
        const sourceRestoration = await rehydrateProductionSourceOwners({
          repository: sourceRepository,
          source_registry: sourceRegistry,
          source_admission_register: admissionRegister,
          continuous_records: sourceRepository.listContinuousRecords(), fencing_verifier: options.continuous_fencing_verifier
        });
        const rawPersistence = new GitRawObjectPersistence({
          repository_path: checkoutPath
        });
        const acquisitions = await rawPersistence.listVerifiedAcquisitions();
        const journalStore = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
          repository_path: checkoutPath,
          stream_id: streamId,
          scope: "PRODUCTION"
        });
        const trusted = await bootstrapTrustedChainCompositionRoot({
          scope: "PRODUCTION",
          restoration_journal: createRawValidatedRestorationJournal(
            rawPersistence,
            journalStore,
            sourceRepository
          )
        });
        const executions = journalStore.listVerifiedExecutions();
        const runs = readRunManifests(checkoutPath);
        for (const run of runs) {
          const ids = [...run.presentation_read_model_ids, ...(run.retained_read_model_ids ?? [])];
          const hashes = [...run.presentation_read_model_hashes, ...(run.retained_read_model_hashes ?? [])];
          if (ids.length !== hashes.length) throw new Error("Presentation run model reference coverage mismatch");
          ids.forEach((id, index) => {
            const model = trusted.root.resolvers.presentation_read_models.resolve(id as never);
            if (!model || model.integrity_hash !== hashes[index]) {
              throw new Error(`PresentationReadModel restoration mismatch: ${id}`);
            }
          });
          for (const reference of run.retained_outcome_references ?? []) {
            const outcome = reference.artifact_kind === "PRESENTATION_DECISION"
              ? trusted.root.resolvers.presentation_decisions.resolve(reference.artifact_id as never)
              : trusted.root.resolvers.presentation_decisions.resolveMigration(reference.artifact_id);
            if (!outcome || outcome.integrity_hash !== reference.integrity_hash) throw new Error("Retained outcome restoration mismatch");
          }
        }
        const seals = executions.flatMap((execution) => execution.record.expected_artifacts);
        const readModels = [...new Set(seals.filter((seal) => seal.artifact_kind === "PRESENTATION_READ_MODEL").map((seal) => seal.artifact_id))].map((id) => {
          const model = trusted.root.resolvers.presentation_read_models.resolve(id as never);
          if (!model) throw new Error(`Historical PresentationReadModel restoration mismatch: ${id}`);
          return model;
        });
        const decisions = [...new Set(seals.filter((seal) => seal.artifact_kind === "PRESENTATION_DECISION").map((seal) => seal.artifact_id))].map((id) => {
          const decision = trusted.root.resolvers.presentation_decisions.resolve(id as never);
          if (!decision) throw new Error(`Historical PresentationDecision restoration mismatch: ${id}`);
          return decision;
        });
        const currentSnapshot = journalStore.readCurrentSnapshot();
        return {
          continuous_records: sourceRepository.listContinuousRecords(),
          continuous_authorizations: [...new Set(sourceRepository.listContinuousRecords().filter(record => record.kind === "GRANT")
            .map(record => record.payload.grant!.authorization_id))].map(id => admissionRegister.resolveContinuousAuthorization(id)),
          committed_head: git(checkoutPath, "rev-parse", "HEAD").trim(),
          source_version_count: sourceRestoration.restored_version_count,
          acquisition_count: acquisitions.length,
          restored_record_count: trusted.restored_record_count,
          restoration_record_ids: executions.map((execution) => {
            return execution.record.restoration_record_id;
          }),
          artifact_seals: executions.flatMap((execution) => {
            return execution.record.expected_artifacts;
          }),
          presentation_decisions: structuredClone(decisions),
          read_models: structuredClone(currentSnapshot?.current_position_read_models ?? []),
          historical_read_models: structuredClone(readModels),
          current_snapshot: currentSnapshot,
          runs
        };
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    },

    async retryPresentationPublish(
      runId: string,
      publisher: (readModels: readonly PresentationReadModel[]) => Promise<void>
    ) {
      const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "zero-cost-publish-"));
      const checkoutPath = path.join(temporaryRoot, "checkout");
      try {
        cloneRemote(remoteUrl, branch, checkoutPath);
        const run = readRunManifests(checkoutPath).find((item) => item.run_id === runId);
        if (!run) throw new Error(`Committed production run is unavailable: ${runId}`);
        const store = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
          repository_path: checkoutPath,
          stream_id: streamId,
          scope: "PRODUCTION"
        });
        const persisted = store.listVerifiedPresentationReadModels() as PresentationReadModel[];
        const byId = new Map(persisted.map((model) => {
          return [model.presentation_read_model_id, model] as const;
        }));
        const selected = run.presentation_read_model_ids.map((id, index) => {
          const model = byId.get(id as never);
          if (!model || model.integrity_hash !== run.presentation_read_model_hashes[index]) {
            throw new Error(`Persisted PresentationReadModel is unavailable: ${id}`);
          }
          return model;
        });
        const snapshot = store.readCurrentSnapshot();
        if (!snapshot) throw new Error("Presentation V2 authoritative current repository is not activated");
        await publisher(structuredClone(snapshot.current_position_read_models));
        return { run_id: runId, status: "PUBLISHED" as const };
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    }
  });
  return root;
}

function createRunManifest(
  input: Omit<ZeroCostCommittedRunManifest, "schema_version" | "status" | "integrity_hash">
) {
  const content = {
    schema_version: RUN_SCHEMA_VERSION,
    ...input,
    status: "COMMITTED" as const
  };
  return { ...content, integrity_hash: canonicalHash(content) };
}

function writeRunManifest(repositoryPath: string, manifest: ZeroCostCommittedRunManifest) {
  const directory = path.join(repositoryPath, "production-runs", "runs");
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${canonicalHash({ run_id: manifest.run_id })}.json`);
  writeFileSync(target, canonicalSerialize(manifest), { encoding: "utf8", flag: "wx" });
}

function readRunManifests(repositoryPath: string) {
  const directory = path.join(repositoryPath, "production-runs", "runs");
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    const absolutePath = path.join(directory, name);
    const relativePath = `production-runs/runs/${name}`;
    const bytes = readFileSync(absolutePath, "utf8");
    const manifest = canonicalDeserialize(bytes) as ZeroCostCommittedRunManifest;
    const { integrity_hash: integrityHash, ...content } = manifest;
    if (canonicalSerialize(manifest) !== bytes
        || manifest.schema_version !== RUN_SCHEMA_VERSION
        || manifest.status !== "COMMITTED"
        || integrityHash !== canonicalHash(content)) {
      throw new Error(`Production run manifest integrity mismatch: ${name}`);
    }
    const introducingCommit = git(repositoryPath, "log", "-1", "--format=%H", "--",
      relativePath).trim();
    const introducingParent = git(repositoryPath, "rev-parse", `${introducingCommit}^`).trim();
    if (introducingParent !== manifest.expected_parent) {
      throw new Error(`Production run expected-parent mismatch: ${name}`);
    }
    return manifest;
  });
}

function squashAndCommit(
  repositoryPath: string,
  expectedParent: string,
  runId: string,
  identity: { readonly name: string; readonly email: string }
) {
  git(repositoryPath, "reset", "--soft", expectedParent);
  git(repositoryPath, "add", "-A");
  const changes = git(repositoryPath, "diff", "--cached", "--name-status").trim();
  if (!changes) throw new Error("Production run produced no state changes");
  for (const line of changes.split(/\r?\n/u)) {
    const [status, file] = line.split(/\s+/u);
    if (status?.startsWith("D") || !file || ![
      "production-runs/",
      "production-source-state/",
      "trusted-objects/",
      "trusted-state/"
    ].some((prefix) => file.startsWith(prefix))) {
      throw new Error(`Atomic commit contains a forbidden change: ${line}`);
    }
  }
  git(repositoryPath,
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit", "-m", `production-run:${runId}`);
  const parent = git(repositoryPath, "rev-parse", "HEAD^").trim();
  if (parent !== expectedParent) throw new Error("Atomic commit parent mismatch");
}

function cloneRemote(remoteUrl: string, branch: string, destination: string) {
  execFileSync("git", [
    "clone", "--quiet", "--single-branch", "--branch", branch,
    "--no-tags", remoteUrl, destination
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(destination, "config", "core.longpaths", "true");
}

function assertRemoteHead(remoteUrl: string, branch: string, expectedParent: string) {
  const actual = remoteHead(remoteUrl, branch);
  if (actual !== expectedParent) {
    throw new Error(`CAS_MISMATCH: expected ${expectedParent}, found ${actual}`);
  }
}

function remoteHead(remoteUrl: string, branch: string) {
  const value = execFileSync("git", [
    "ls-remote", remoteUrl, `refs/heads/${branch}`
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const hash = value.split(/\s+/u)[0];
  if (!hash) throw new Error(`Remote branch is unavailable: ${branch}`);
  return hash;
}

function currentVersion(
  versions: readonly SourcePersistenceVersion[],
  kind: SourcePersistenceVersion["artifact"]["kind"],
  streamId: string
) {
  const version = versions.filter((item) => {
    return item.artifact.kind === kind && item.stream_id === streamId;
  }).sort((left, right) => left.revision - right.revision).at(-1);
  if (!version) throw new Error(`Source persistence version is unavailable: ${kind}`);
  return version;
}

function readModelFrom(output: unknown) {
  if (!output || typeof output !== "object" || !("read_model" in output)) {
    throw new Error("PresentationReadModel command returned an invalid result");
  }
  return structuredClone((output as { readonly read_model: PresentationReadModel }).read_model);
}

function toExtractedRecordV2(
  snapshot: Snapshot,
  record: ExtractedRecord,
  adapter: RecruitmentAdapter
) {
  return createExtractedRecordV2(snapshot, {
    source_definition_id: record.source_definition_id,
    identity_candidates: record.identity_candidates,
    raw_source_record_id: record.raw_source_record_id,
    raw_title: record.raw_title,
    raw_organization_name: record.raw_organization_name,
    raw_location_text: record.raw_location_text,
    raw_description: record.raw_description,
    raw_requirement_text: record.raw_requirement_text,
    announcement_url: record.announcement_url,
    application_url: record.application_url,
    publish_time: record.publish_time,
    deadline: record.deadline,
    recruitment_year: record.recruitment_year,
    recruitment_batch: record.recruitment_batch,
    recruitment_context: record.recruitment_context,
    source_record_locator: record.source_record_locator,
    adapter_metadata: record.adapter_metadata,
    extraction: {
      extractor_name: record.extraction.extractor_name,
      extractor_version: record.extraction.extractor_version,
      schema_version: `${adapter.descriptor.adapter_key}-extracted-record/2.0.0`
    }
  });
}

function event(
  status: ZeroCostProductionRunStatus,
  at: string,
  detail: string
): ZeroCostProductionRunEvent {
  return { status, at, detail };
}

function emptyResult(
  runId: string,
  status: ZeroCostProductionRunStatus,
  lifecycle: readonly ZeroCostProductionRunEvent[],
  error: string
): ZeroCostProductionRunResult {
  return result(runId, status, lifecycle, null, null, { error });
}

function result(
  runId: string,
  status: ZeroCostProductionRunStatus,
  lifecycle: readonly ZeroCostProductionRunEvent[],
  expectedParent: string | null,
  committedHead: string | null,
  options: {
    readonly rawBlobIds?: readonly string[];
    readonly snapshotIds?: readonly string[];
    readonly extractedRecordIds?: readonly string[];
    readonly restorationRecordIds?: readonly string[];
    readonly readModelIds?: readonly string[];
    readonly publishStatus?: ZeroCostProductionRunResult["presentation_publish_status"];
    readonly error?: string | null;
  }
): ZeroCostProductionRunResult {
  return Object.freeze({
    run_id: runId,
    status,
    lifecycle: structuredClone(lifecycle),
    expected_parent: expectedParent,
    committed_head: committedHead,
    raw_blob_ids: [...(options.rawBlobIds ?? [])],
    snapshot_ids: [...(options.snapshotIds ?? [])],
    extracted_record_ids: [...(options.extractedRecordIds ?? [])],
    restoration_record_ids: [...(options.restorationRecordIds ?? [])],
    presentation_read_model_ids: [...(options.readModelIds ?? [])],
    presentation_publish_status: options.publishStatus ?? "NOT_REQUESTED",
    error: options.error ?? null
  });
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function required(value: string, name: string) {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
