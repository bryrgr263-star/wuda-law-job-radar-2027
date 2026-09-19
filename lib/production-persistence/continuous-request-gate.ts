import { randomUUID, createHash } from "node:crypto";
import { InMemorySourceAdmissionRegister } from "../application/source-admission/source-admission-register";
import { currentContinuousGrant, type ContinuousScope, type ContinuousFencingVerifier } from "../application/source-admission/continuous-acquisition";
import type { HttpTransportRequest, HttpTransport } from "../collection-runtime/types";
import type { TransportResponse } from "../ingestion/domain/raw";
import { InMemorySourceRegistry } from "../ingestion/registry/source-registry";
import { resolveContinuousSourceContext } from "./continuous-source-context";
import { GitSourceRegistryPersistence } from "./git-source-registry-persistence";
import { rehydrateProductionSourceOwners } from "./source-owner-rehydration";

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
    : await executeContinuousOfficialRequest(request, options.now);
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
  const url = new URL(request.locator);
  if (request.method !== "GET" || request.body !== undefined || Object.keys(request.headers).length
    || Object.keys(request.parameters).length || url.protocol !== "https:" || url.href !== request.locator
    || url.username || url.password || url.hash || url.search || !Number.isSafeInteger(request.timeout_ms) || request.timeout_ms < 1) {
    throw new Error("EXACT_REQUEST_DENIED");
  }
  const response = await fetch(request.locator, { method: "GET", redirect: "manual", credentials: "omit",
    headers: {}, signal: AbortSignal.timeout(request.timeout_ms) });
  const headers = Object.fromEntries(response.headers.entries());
  if (response.status < 200 || response.status >= 300 || response.redirected || response.headers.has("set-cookie")) {
    await response.body?.cancel();
    return { status: "FAILED", responded_at: now() as TransportResponse["responded_at"], http_status: response.status,
      headers, mime_type: response.headers.get("content-type"), error: { code: "OFFICIAL_NETWORK_POLICY_STOP",
        message: "HTTP, redirect, session or access requirement denied", retryable: false } };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status: "SUCCESS", responded_at: now() as TransportResponse["responded_at"], bytes,
    content_sha256: createHash("sha256").update(bytes).digest("hex") as Extract<TransportResponse, { status: "SUCCESS" }>["content_sha256"],
    http_status: response.status, headers, mime_type: response.headers.get("content-type") ?? "application/octet-stream" };
}
