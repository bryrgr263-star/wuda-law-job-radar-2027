import { randomUUID, createHash } from "node:crypto";
import { InMemorySourceAdmissionRegister } from "../application/source-admission/source-admission-register";
import { currentContinuousGrant, validateContinuousContext, type ContinuousScope, type ContinuousFencingVerifier } from "../application/source-admission/continuous-acquisition";
import { assertApprovedQueryRequest, type QueryAuthorizationContract } from "../application/source-admission/query-authorization";
import type { HttpTransportRequest, HttpTransport } from "../collection-runtime/types";
import type { TransportResponse } from "../ingestion/domain/raw";
import { InMemorySourceRegistry } from "../ingestion/registry/source-registry";
import { resolveContinuousSourceContext } from "./continuous-source-context";
import { GitSourceRegistryPersistence } from "./git-source-registry-persistence";
import { rehydrateProductionSourceOwners } from "./source-owner-rehydration";
import { publishSupportingInspectionClaim, type SupportingInspectionPublicationOptions } from "./supporting-inspection-publisher";
import { supportingInspectionReplay } from "./source-inspection-replay";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { execFileSync } from "node:child_process";

export async function executeSupportingInspectionRequest(
  inputOptions: SupportingInspectionPublicationOptions & { readonly collection_run_id: string },
  inputRequest: HttpTransportRequest
) {
  const options = structuredClone(inputOptions);
  const request = structuredClone(inputRequest);
  const now = () => new Date().toISOString();
  const claim = options.claim;
  if (claim.artifact.kind !== "SUPPORTING_INSPECTION_EXECUTION" || claim.artifact.payload.state !== "CLAIMED") {
    throw new Error("SUPPORTING_INSPECTION_NEW_CLAIM_REQUIRED");
  }
  const record = claim.artifact.payload;
  const validateTime = () => {
    const actual = Date.parse(now());
    for (const value of [record.claimed_at, record.authorization.issued_at, claim.created_at, claim.effective_at, request.requested_at]) {
      if (!Number.isFinite(Date.parse(value)) || Date.parse(value) > actual) throw new Error("SUPPORTING_INSPECTION_FUTURE_TIME_DENIED");
    }
  };
  validateTime();
  if (request.locator !== record.exact_url || request.method !== record.method
    || request.recruitment_endpoint_id !== record.authorization.recruitment_endpoint_id
    || options.collection_run_id !== record.authorization.collection_run_id
    || request.body !== undefined || Object.keys(request.headers).length || Object.keys(request.parameters).length
    || !Number.isSafeInteger(request.timeout_ms) || request.timeout_ms < 1
    || Reflect.has(options, "controlled_transport") || Reflect.has(options, "now")) {
    throw new Error("SUPPORTING_INSPECTION_EXACT_REQUEST_DENIED");
  }
  const initial = new GitSourceRegistryPersistence({ repository_path: options.repository_path });
  initial.assertAuthoritativeHead(options.branch, options.expected_parent);
  const initialVersions = await initial.listVersions();
  const proposed = supportingInspectionReplay([...initialVersions, claim]);
  const proposedIndex = proposed.records.length - 1;
  const proposedContext = proposed.resolve(record, proposedIndex);
  assertApprovedQueryRequest(request.locator, proposedContext.query_contract);
  if (proposedContext.query_contract.request_budget !== 1) throw new Error("SUPPORTING_INSPECTION_BUDGET_DENIED");
  const publication = await publishSupportingInspectionClaim(options);
  const fresh = new GitSourceRegistryPersistence({ repository_path: options.repository_path });
  fresh.assertAuthoritativeHead(options.branch, publication.committed_head);
  const versions = await fresh.listVersions();
  if (canonicalSerialize(versions.at(-1)) !== canonicalSerialize(claim)) throw new Error("SUPPORTING_INSPECTION_READBACK_DENIED");
  const replay = supportingInspectionReplay(versions);
  const index = replay.records.findIndex(item => item.authorization.authorization_id === record.authorization.authorization_id);
  if (index < 0 || canonicalSerialize(replay.current.find(item => item.authorization.authorization_id === record.authorization.authorization_id))
    !== canonicalSerialize(record)) throw new Error("SUPPORTING_INSPECTION_CURRENT_CLAIM_DENIED");
  const context = replay.resolve(record, index);
  for (const id of Object.values(record.bindings)) {
    const version = versions.find(item => item.artifact_id === id);
    if (!version || versions.filter(item => item.stream_id === version.stream_id && item.artifact.kind === version.artifact.kind).at(-1)?.artifact_id !== id) {
      throw new Error("SUPPORTING_INSPECTION_STALE_SOURCE_DENIED");
    }
  }
  assertApprovedQueryRequest(request.locator, context.query_contract);
  validateTime();
  if (execFileSync("git", ["status", "--porcelain=v1"], { cwd: options.repository_path, encoding: "utf8", windowsHide: true }).trim()) {
    throw new Error("SUPPORTING_INSPECTION_DIRTY_STATE_DENIED");
  }
  fresh.assertAuthoritativeHead(options.branch, publication.committed_head);
  const response = await executeVerifiedOfficialRequest(request, now, context.query_contract);
  return { response, committed_claim_head: publication.committed_head };
}

export interface ContinuousRequestGateOptions {
  readonly repository_path: string;
  readonly branch: string;
  readonly authorization_ids: readonly string[];
  readonly source_admission_id: string;
  readonly recruitment_endpoint_id: string;
  readonly scope: ContinuousScope;
  readonly commit_identity: { readonly name: string; readonly email: string };
  readonly now: () => string;
  readonly fencing_verifier?: ContinuousFencingVerifier;
  readonly controlled_transport?: HttpTransport;
  readonly after_reservation?: () => void | Promise<void>;
}

export async function executeContinuousRequest(options: ContinuousRequestGateOptions, inputRequest: HttpTransportRequest) {
  const request = structuredClone(inputRequest);
  if (options.controlled_transport && options.scope !== "CONTROLLED_TEST") throw new Error("CONTROLLED_TRANSPORT_NOT_ALLOWED");
  const repository = new GitSourceRegistryPersistence({ repository_path: options.repository_path, fencing_verifier: options.fencing_verifier });
  const parent = repository.readCommittedHead();
  repository.assertAuthoritativeHead(options.branch, parent);
  const versions = await repository.listVersions();
  const records = repository.listContinuousRecords();
  const candidates = options.authorization_ids.map(id => currentContinuousGrant(records, id))
    .filter(grant => grant.canonical_payload.exact_endpoint === request.locator);
  if (candidates.length !== 1) throw new Error("EXACT_AUTHORIZATION_REFERENCE_REQUIRED");
  const grant = candidates[0]!;
  const context = resolveContinuousSourceContext(versions, grant.canonical_payload.bindings.target.id);
  if (context.admission.source_admission_id !== options.source_admission_id
    || context.endpoint.recruitment_endpoint_id !== options.recruitment_endpoint_id
    || request.recruitment_endpoint_id !== options.recruitment_endpoint_id) throw new Error("SOURCE_RUN_BINDING_MISMATCH");
  const owner = new InMemorySourceAdmissionRegister();
  await rehydrateProductionSourceOwners({ repository, source_registry: new InMemorySourceRegistry(),
    source_admission_register: owner, continuous_records: records, fencing_verifier: options.fencing_verifier });
  const attemptId = `continuous-attempt:${randomUUID()}`;
  const holder = `continuous-holder:${randomUUID()}`;
  const reserve = owner.reserveContinuousAttempt(grant.authorization_id, context, request, attemptId, holder, options.now(), options.scope);
  const reservationHead = await repository.publishContinuousRecord(reserve, { expected_parent: parent,
    branch: options.branch, commit_identity: options.commit_identity });
  await options.after_reservation?.();
  repository.assertAuthoritativeHead(options.branch, reservationHead);
  const response = options.controlled_transport
    ? await options.controlled_transport.execute(structuredClone(request))
    : await executeVerifiedOfficialRequest(request, options.now, validateContinuousContext(context).query_contract);
  if (!response || (response.status !== "SUCCESS" && response.status !== "FAILED")) throw new Error("SEND_STATE_UNKNOWN");
  const current = new GitSourceRegistryPersistence({ repository_path: options.repository_path, fencing_verifier: options.fencing_verifier });
  current.assertAuthoritativeHead(options.branch, reservationHead);
  owner.restoreContinuousRecords(current.listContinuousRecords(), bindings => resolveContinuousSourceContext(versions, bindings), options.fencing_verifier);
  const complete = owner.closeContinuousAttempt(attemptId, holder, options.now(), response.status);
  const head = await current.publishContinuousRecord(complete, { expected_parent: reservationHead,
    branch: options.branch, commit_identity: options.commit_identity });
  return { response: structuredClone(response), committed_head: head };
}

export async function executeContinuousOfficialRequest(request: HttpTransportRequest, now: () => string): Promise<TransportResponse> {
  return executeVerifiedOfficialRequest(request, now);
}

async function executeVerifiedOfficialRequest(request: HttpTransportRequest, now: () => string, queryContract?: QueryAuthorizationContract): Promise<TransportResponse> {
  const url = new URL(request.locator);
  if (queryContract) assertApprovedQueryRequest(request.locator, queryContract);
  if (request.method !== "GET" || request.body !== undefined || Object.keys(request.headers).length
    || Object.keys(request.parameters).length || url.protocol !== "https:" || url.href !== request.locator
    || url.username || url.password || url.hash || (url.search && !queryContract) || !Number.isSafeInteger(request.timeout_ms) || request.timeout_ms < 1) {
    throw new Error("EXACT_REQUEST_DENIED");
  }
  const response = await fetch(request.locator, { method: "GET", redirect: "manual", credentials: "omit",
    headers: {}, signal: AbortSignal.timeout(request.timeout_ms) });
  const mimeType = safeContentType(response.headers.get("content-type"));
  const responseSetCookiePresent = response.headers.has("set-cookie");
  const headers: Record<string, string> = {};
  if (mimeType) headers["content-type"] = mimeType;
  const policyReasons: string[] = [];
  if (response.status < 200 || response.status >= 300) policyReasons.push("HTTP_STATUS_OUTSIDE_SUCCESS");
  if (response.status >= 300 && response.status < 400) {
    policyReasons.push("REDIRECT_RESPONSE");
    const location = response.headers.get("location");
    try {
      if (!location) throw new Error("REDIRECT_LOCATION_MISSING");
      if (new URL(location, request.locator).href !== request.locator) policyReasons.push("REDIRECT_TARGET_NOT_APPROVED");
    } catch {
      policyReasons.push("REDIRECT_TARGET_UNVERIFIABLE");
    }
  }
  if (response.redirected) policyReasons.push("RESPONSE_REDIRECTED");
  if (response.status === 401 || response.headers.has("www-authenticate")) policyReasons.push("AUTHENTICATION_REQUIRED");
  if (response.headers.get("cf-mitigated")?.toLowerCase() === "challenge") policyReasons.push("CHALLENGE_RESPONSE_PRESENT");
  if (policyReasons.length) {
    await response.body?.cancel();
    return { status: "FAILED", responded_at: now() as TransportResponse["responded_at"], http_status: response.status,
      headers, mime_type: mimeType, response_set_cookie_present: responseSetCookiePresent,
      error: { code: "OFFICIAL_NETWORK_POLICY_STOP",
        message: "HTTP, redirect, session or access requirement denied", retryable: false,
        policy_reason_codes: policyReasons } };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status: "SUCCESS", responded_at: now() as TransportResponse["responded_at"], bytes,
    content_sha256: createHash("sha256").update(bytes).digest("hex") as Extract<TransportResponse, { status: "SUCCESS" }>["content_sha256"],
    http_status: response.status, headers, mime_type: mimeType ?? "application/octet-stream",
    response_set_cookie_present: responseSetCookiePresent };
}

function safeContentType(contentType: string | null) {
  if (!contentType || !/^[\w.+-]+\/[\w.+-]+(?:;\s*charset=[\w-]+)?$/iu.test(contentType)) return null;
  return contentType;
}
