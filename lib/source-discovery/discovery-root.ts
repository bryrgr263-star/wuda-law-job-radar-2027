import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";
import { createDiscoveryRecord, type DiscoveryRecord } from "./contracts";
import { DiscoveryBudget, type DiscoveryPolicy, type DiscoveryBudgetSnapshot } from "./discovery-budget";
import { GitDiscoveryStore } from "./git-discovery-store";
import { observeDirectory } from "./adapters/official-directory";
import { publicDiscoveryAddress, safeDiscoveryUrl } from "./safety";
import { prepareAdmissionProposal } from "./admission-proposal";
import { DirectoryHttpFailure, prepareDirectoryHttpRequest } from "./adapters/official-directory-http";

export interface DirectoryResponse {
  http_status: number; final_url: string; addresses: string[]; content_type: string; body: string;
  response_set_cookie_present: boolean;
  content_sha256?: string;
  received_byte_length?: number;
}
interface RootOptions {
  store: GitDiscoveryStore; run_id: string; scope: DiscoveryPolicy; started_at: string;
  approved_scope_hash: string; mode: "OFFLINE_FIXTURE" | "REAL_DIRECTORY";
  cooldowns?: Record<string, string>;
}
export interface OfflineDirectoryFixture {
  kind: "OFFLINE_DIRECTORY_FIXTURE";
  responses: Record<string, DirectoryResponse | { failure: "NETWORK_FAILURE" }>;
}

export class DiscoveryRoot {
  private options: RootOptions;
  private budget: DiscoveryBudget;
  private halted = false;
  private expectedHead: string;

  constructor(options: RootOptions) {
    if (!["OFFLINE_FIXTURE", "REAL_DIRECTORY"].includes(options.mode) || !options.run_id.trim()
      || canonicalHash(options.scope) !== options.approved_scope_hash) throw new Error("DISCOVERY_SCOPE_NOT_APPROVED");
    this.options = { ...options, scope: structuredClone(options.scope) };
    this.expectedHead = options.store.head();
    const priorRuns = options.store.restore(this.expectedHead).current("RUN");
    if (priorRuns.some(record => record.payload.stage === "REVOKED" && record.payload.scope_hash === options.approved_scope_hash)) {
      throw new Error("DISCOVERY_SCOPE_REVOKED");
    }
    const cooldowns: Record<string, string> = { ...options.cooldowns };
    const attempts = new Map<string, { organization: string; url: string; at: string; status: string }>();
    for (const record of priorRuns) {
      const state = record.payload.budget as DiscoveryBudgetSnapshot;
      DiscoveryBudget.restore(state);
      if (state.events.some(event => event.kind === "RESERVE" && !state.events.some(next => next.kind === "OBSERVE" && next.intent_id === event.intent_id))) {
        throw new Error("DISCOVERY_UNRESOLVED_RESERVATION");
      }
      for (const event of state.events) {
        if (event.kind !== "OBSERVE") continue;
        const reserve = state.events.find(entry => entry.kind === "RESERVE" && entry.intent_id === event.intent_id);
        if (reserve?.kind === "RESERVE") attempts.set(event.intent_id, { organization: reserve.organization, url: reserve.url, at: event.at, status: event.status });
      }
    }
    const failures = new Map<string, number>();
    for (const attempt of attempts.values()) {
      const count = attempt.status === "NETWORK_FAILURE" ? (failures.get(attempt.organization) ?? 0) + 1 : 0;
      failures.set(attempt.organization, count);
      const interval = count ? Math.min(7 * 86400, 86400 * 2 ** (count - 1)) : options.scope.budget.cooldown_seconds;
      const effective = new Date(Date.parse(attempt.at) + (interval - options.scope.budget.cooldown_seconds) * 1000).toISOString();
      if (!cooldowns[attempt.organization] || Date.parse(effective) > Date.parse(cooldowns[attempt.organization]!)) cooldowns[attempt.organization] = effective;
      const targetKey = `target:${canonicalHash(attempt.url)}`;
      if (!cooldowns[targetKey] || Date.parse(effective) > Date.parse(cooldowns[targetKey]!)) cooldowns[targetKey] = effective;
    }
    this.budget = new DiscoveryBudget(options.scope, options.started_at, cooldowns);
    const existing = options.store.restore(options.store.head()).list("RUN").filter(record => record.logical_id === this.runIdentity());
    if (existing.length) throw new Error("DISCOVERY_RUN_EXISTS_RESTORE_REQUIRED");
    this.persist("STARTED", options.started_at);
  }

  private runIdentity() { return `discovery:run:${canonicalHash(this.options.run_id)}`; }
  private provenanceKind() { return this.options.mode; }
  private observerActor() { return this.options.mode === "OFFLINE_FIXTURE" ? "OFFLINE_DIRECTORY_OBSERVER" : "REAL_DIRECTORY_OBSERVER"; }

  private assertRepositoryGate(organization: string, url: string, at: string): void {
    const runs = this.options.store.restore(this.expectedHead).current("RUN");
    const attempts: { at: string; status: string; intent_id: string }[] = [];
    for (const run of runs) {
      if (run.payload.stage === "REVOKED" && run.payload.scope_hash === this.options.approved_scope_hash) throw new Error("DISCOVERY_SCOPE_REVOKED");
      const state = run.payload.budget as DiscoveryBudgetSnapshot;
      DiscoveryBudget.restore(state);
      for (const reserve of state.events) {
        if (reserve.kind !== "RESERVE") continue;
        const observed = state.events.find(event => event.kind === "OBSERVE" && event.intent_id === reserve.intent_id);
        if (!observed) throw new Error("DISCOVERY_UNRESOLVED_RESERVATION");
        if (run.logical_id !== this.runIdentity() && observed.kind === "OBSERVE"
          && (reserve.organization === organization || reserve.url === url)) attempts.push({ at: observed.at, status: observed.status, intent_id: observed.intent_id });
      }
    }
    attempts.sort((left, right) => left.at < right.at ? -1 : left.at > right.at ? 1 : left.intent_id < right.intent_id ? -1 : 1);
    let failures = 0;
    for (const attempt of attempts) {
      failures = attempt.status === "NETWORK_FAILURE" ? failures + 1 : 0;
      const interval = failures ? Math.min(7 * 86400, 86400 * 2 ** (failures - 1)) : this.options.scope.budget.cooldown_seconds;
      if (Date.parse(at) - Date.parse(attempt.at) < interval * 1000) throw new Error("DISCOVERY_COOLDOWN");
    }
  }

  private persist(stage: string, at: string, additions: DiscoveryRecord[] = []): void {
    const parent = this.expectedHead;
    if (this.options.store.head() !== parent) { this.halted = true; throw new Error("DISCOVERY_STALE_ROOT_CAS"); }
    const prior = this.options.store.restore(parent).list("RUN").filter(record => record.logical_id === this.runIdentity()).at(-1);
    const run = createDiscoveryRecord("RUN", this.runIdentity(), {
      run_id: this.options.run_id, actor: this.options.scope.approved_by, observed_at: at,
      provenance_kind: this.provenanceKind(), mode: this.options.mode, scope_hash: this.options.approved_scope_hash,
      input_sha: prior?.payload.input_sha ?? parent, stage, budget: this.budget.snapshot()
    }, prior ? [prior] : [], (prior?.revision ?? 0) + 1);
    try { this.expectedHead = this.options.store.commit([...additions, run], parent); }
    catch (error) { this.halted = true; throw error; }
  }

  budgetSnapshot() { return this.budget.snapshot(); }

  revoke(at: string): void {
    this.persist("REVOKED", at);
    this.halted = true;
  }

  static restore(input: { store: GitDiscoveryStore; sha: string; run_id: string; approved_scope_hash: string; mode: "OFFLINE_FIXTURE" | "REAL_DIRECTORY" }): DiscoveryRoot {
    const runs = input.store.restore(input.sha).list("RUN").filter(record => record.logical_id === `discovery:run:${canonicalHash(input.run_id)}`);
    if (!runs.length || !["OFFLINE_FIXTURE", "REAL_DIRECTORY"].includes(input.mode)) throw new Error("DISCOVERY_RUN_NOT_FOUND");
    let previousEvents: unknown[] = [];
    for (const record of runs) {
      const snapshot = record.payload.budget as DiscoveryBudgetSnapshot;
      DiscoveryBudget.restore(snapshot);
      if (record.payload.mode !== input.mode || record.payload.provenance_kind !== input.mode
        || record.payload.scope_hash !== input.approved_scope_hash || canonicalHash(snapshot.policy) !== input.approved_scope_hash
        || canonicalHash(snapshot.events.slice(0, previousEvents.length)) !== canonicalHash(previousEvents)) throw new Error("DISCOVERY_REPLAY_MISMATCH");
      previousEvents = snapshot.events;
    }
    const last = runs.at(-1)!;
    const snapshot = last.payload.budget as DiscoveryBudgetSnapshot;
    if (!snapshot.policy) throw new Error("DISCOVERY_SCOPE_REQUIRED");
    const root = Object.create(DiscoveryRoot.prototype) as DiscoveryRoot;
    root.options = { ...input, scope: snapshot.policy, started_at: snapshot.started_at, cooldowns: snapshot.cooldowns };
    root.budget = DiscoveryBudget.restore(snapshot);
    root.halted = last.payload.stage === "REVOKED" || last.payload.stage === "RESPONSE_BUDGET_EXCEEDED_UNRESOLVED";
    root.expectedHead = input.sha;
    return root;
  }

  async discover(organization: string, url: string, at: string,
    fixture: OfflineDirectoryFixture): Promise<void> {
    if (this.options.mode !== "OFFLINE_FIXTURE" || !fixture || fixture.kind !== "OFFLINE_DIRECTORY_FIXTURE") throw new Error("DISCOVERY_FIXTURE_REQUIRED");
    return this.discoverInput(organization, url, at, fixture);
  }

  async discoverLive(organization: string, url: string): Promise<void> {
    if (this.options.mode !== "REAL_DIRECTORY") throw new Error("DISCOVERY_REAL_SCOPE_REQUIRED");
    return this.discoverInput(organization, url, new Date().toISOString(), null);
  }

  private async discoverInput(organization: string, url: string, at: string, fixture: OfflineDirectoryFixture | null): Promise<void> {
    if ((fixture === null) !== (this.options.mode === "REAL_DIRECTORY")) throw new Error("DISCOVERY_MODE_MISMATCH");
    if (this.halted) throw new Error("DISCOVERY_ROOT_HALTED");
    if (this.options.store.head() !== this.expectedHead) throw new Error("DISCOVERY_STALE_ROOT_CAS");
    if (fixture && fixture.kind !== "OFFLINE_DIRECTORY_FIXTURE") throw new Error("DISCOVERY_FIXTURE_REQUIRED");
    if (fixture) canonicalHash(fixture);
    let intent: ReturnType<DiscoveryBudget["reserve"]>;
    try { this.assertRepositoryGate(organization, url, at); intent = this.budget.reserve(organization, url, at); }
    catch (error) {
      const permitted = new Set(["DISCOVERY_SCOPE_DENIED", "DISCOVERY_TARGET_DENIED", "DISCOVERY_COOLDOWN", "DISCOVERY_UNRESOLVED_RESERVATION", "DISCOVERY_BUDGET_EXHAUSTED", "DISCOVERY_SCOPE_REVOKED"]);
      if (!(error instanceof Error) || !permitted.has(error.message)) { this.halted = true; throw error; }
      const reason = error instanceof Error && permitted.has(error.message) ? error.message : "DISCOVERY_TARGET_DENIED";
      const denied = createDiscoveryRecord("OBSERVATION", `discovery:denied:${canonicalHash({ run: this.options.run_id, organization, url_hash: canonicalHash(url), at })}`, {
        request_state: "NOT_SENT", status: "POLICY_DENIED", target_hash: canonicalHash(url), observed_at: at,
        provenance_kind: this.provenanceKind(), scope_hash: this.options.approved_scope_hash, reason
      });
      this.persist("PRE_SEND_DENIED", at, [denied]);
      return;
    }
    this.persist("RESERVED", at);
    let prepared: Awaited<ReturnType<typeof prepareDirectoryHttpRequest>> | null = null;
    if (!fixture) {
      try {
        const remaining = Math.min(60000, Date.parse(this.options.started_at)
          + this.options.scope.budget.runtime_seconds * 1000 - Date.now());
        prepared = await prepareDirectoryHttpRequest(url, this.options.scope.budget.max_response_bytes, remaining);
        at = new Date().toISOString();
        if (Date.parse(at) >= Date.parse(this.options.scope.expires_at)
          || Date.parse(at) >= Date.parse(this.options.started_at) + this.options.scope.budget.runtime_seconds * 1000) {
          throw new Error("DISCOVERY_SCOPE_DENIED");
        }
      } catch (error) {
        if (this.halted) throw new Error("DISCOVERY_ROOT_HALTED");
        const reason = error instanceof Error && /^DISCOVERY_[A-Z_]+$/.test(error.message) ? error.message : "DISCOVERY_DNS_FAILURE";
        this.finish(intent, "POLICY_DENIED", new Date().toISOString(), 0, false, [], { reason });
        return;
      }
    }
    if (this.halted) throw new Error("DISCOVERY_ROOT_HALTED");
    this.budget.markSent(intent.intent_id, at);
    this.persist("SEND_ENTERED", at);
    let supplied: DirectoryResponse | { failure: "NETWORK_FAILURE" } | undefined;
    if (fixture) supplied = fixture.responses[intent.url];
    else {
      try { supplied = await prepared!.execute(); }
      catch (error) {
        if (this.halted) throw new Error("DISCOVERY_ROOT_HALTED");
        const received = error instanceof DirectoryHttpFailure ? error.received_bytes : 0;
        const reason = error instanceof DirectoryHttpFailure ? error.reason_code : "DISCOVERY_HTTP_REQUEST_FAILED";
        const consumed = this.budget.snapshot().events.filter(event => event.kind === "OBSERVE").reduce((sum, event) => sum + event.byte_length, 0);
        if (received > this.options.scope.budget.max_response_bytes || received + consumed > this.options.scope.budget.max_total_bytes) {
          const observation = createDiscoveryRecord("OBSERVATION", `discovery:oversize:${canonicalHash(intent.intent_id)}`, {
            intent_id: intent.intent_id, request_state: "SENT", status: "RESPONSE_BUDGET_EXCEEDED_UNRESOLVED",
            received_bytes: received, reason, provenance_kind: this.provenanceKind(), observed_at: new Date().toISOString()
          });
          this.persist("RESPONSE_BUDGET_EXCEEDED_UNRESOLVED", new Date().toISOString(), [observation]);
          this.halted = true;
          return;
        }
        this.finish(intent, "NETWORK_FAILURE", new Date().toISOString(), received, false, [], { reason });
        return;
      }
      at = new Date().toISOString();
    }
    if (this.halted) throw new Error("DISCOVERY_ROOT_HALTED");
    if (!supplied || "failure" in supplied) {
      this.finish(intent, "NETWORK_FAILURE", at, 0, false);
      return;
    }
    const response = structuredClone(supplied);
    const length = fixture ? Buffer.byteLength(response.body, "utf8") : response.received_byte_length!;
    if (length > this.options.scope.budget.max_response_bytes
      || length + this.budget.snapshot().events.filter(event => event.kind === "OBSERVE").reduce((sum, event) => sum + event.byte_length, 0) > this.options.scope.budget.max_total_bytes) {
      this.persist("RESPONSE_BUDGET_EXCEEDED_UNRESOLVED", at);
      this.halted = true;
      return;
    }
    let status = "SUCCESS";
    if (response.http_status >= 300 && response.http_status < 400) status = "REDIRECT_NOT_FOLLOWED";
    else if (response.final_url !== url || !response.addresses.length || response.addresses.some(address => !publicDiscoveryAddress(address))) status = "POLICY_DENIED";
    else if ([401, 403, 429].includes(response.http_status) || /(?:captcha|cf-chl-|password\s*['"]?\s*type|type\s*=\s*['"]password|登录后|sign in to continue)/i.test(response.body)) status = "ACCESS_BLOCKED";
    else if (response.http_status === 404) status = "UNAVAILABLE";
    else if (response.http_status !== 200) status = "NETWORK_FAILURE";
    else if (!/^text\/html(?:;|$)/i.test(response.content_type)) status = "UNSUPPORTED";
    const additions: DiscoveryRecord[] = [];
    if (status === "SUCCESS") {
      const catalog = this.options.store.restore(this.options.store.head());
      const remaining = Math.max(0, this.options.scope.budget.max_candidate_urls - catalog.list("OBSERVATION").filter(record => record.payload.run_id === this.options.run_id && record.payload.frontier === true).length);
      const directory = observeDirectory(response.body, url, remaining);
      const sentRun = catalog.list("RUN").filter(record => record.logical_id === this.runIdentity()).at(-1)!;
      for (const [ordinal, entry] of directory.selected.entries()) {
        const observation = createDiscoveryRecord("OBSERVATION", `discovery:observation:${canonicalHash({ intent: intent.intent_id, ordinal })}`, {
          ...entry, run_id: this.options.run_id, frontier: true, publisher_url: url, observed_at: at,
          provenance_kind: this.provenanceKind(), content_hash: directory.content_hash, request_state: "SENT",
          intent_id: intent.intent_id, scope_hash: this.options.approved_scope_hash,
          reconstruction_limit: "RAW_HTML_NOT_RETAINED_SAFE_QUOTE_AND_HASH_ONLY"
        }, [sentRun]);
        additions.push(observation);
        const identity = `discovery:candidate:${canonicalHash({ publisher: url, target: entry.url_hash })}`;
        const prior = catalog.list("CANDIDATE").filter(record => record.logical_id === identity).at(-1);
        const candidate = createDiscoveryRecord("CANDIDATE", identity, {
          provenance_kind: this.provenanceKind(), employer_claim: entry.quote, employer_identity: "UNRESOLVED",
          publisher_identity: "UNRESOLVED", recruitment_owner_identity: "UNRESOLVED", hosting_platform_identity: "UNRESOLVED",
          recruitment_entry_url: entry.url, officiality: "UNRESOLVED", production_admission_status: "NOT_SUBMITTED",
          recruitment_year_signal: /2027(?:\s*届|\s*年)?/.test(entry.quote) ? "OBSERVED" : "NOT_OBSERVED",
          legal_signal: /法务|法律|法学|知识产权/.test(entry.quote) ? "OBSERVED" : "NOT_OBSERVED",
          disposition: !entry.url ? "EVIDENCE_BLOCKED" : prior && (prior.payload.claim_conflict === true || prior.payload.employer_claim !== entry.quote) ? "REVIEW_REQUIRED" : "PENDING_VERIFICATION",
          prior_employer_claim: prior?.payload.employer_claim ?? null,
          claim_conflict: prior ? prior.payload.claim_conflict === true || prior.payload.employer_claim !== entry.quote : false
        }, [...(prior ? [prior] : []), observation], (prior?.revision ?? 0) + 1);
        additions.push(candidate);
        catalog.append(observation); catalog.append(candidate);
        if (!prior) additions.push(createDiscoveryRecord("SEED", `discovery:seed:${canonicalHash(identity)}`, {
          candidate_id: identity, employer_claim: entry.quote, recruitment_entry_url: entry.url,
          provenance_kind: this.provenanceKind(), actor: this.observerActor(), observed_at: at,
          unknown_signal: true, next_due: new Date(Date.parse(at) + this.options.scope.budget.cooldown_seconds * 1000).toISOString(),
          production_activation: false
        }, [candidate]));
        additions.push(createDiscoveryRecord("VERIFICATION", `discovery:disposition:${canonicalHash(observation.record_id)}`, {
          axis: "ADMISSION_DISPOSITION", result: candidate.payload.disposition, candidate_id: identity,
          actor: this.observerActor(), observed_at: at, reason: "NO_PRODUCTION_ADMISSION_OR_AUTHORIZATION",
          authority: "UNTRUSTED_OBSERVATION_NOT_ADMISSION", admission_proposal: prepareAdmissionProposal(candidate)
        }, [candidate]));
        for (const axis of ["OFFICIALITY", "RECRUITMENT_YEAR", "LEGAL_DISCOVERY"] as const) {
          additions.push(createDiscoveryRecord("VERIFICATION", `discovery:evidence:${canonicalHash({ observation: observation.record_id, axis })}`, {
            axis, actor: this.observerActor(), observed_at: at, quote: entry.quote, locator: entry.locator,
            result: axis === "OFFICIALITY" ? "UNRESOLVED" : axis === "RECRUITMENT_YEAR" ? candidate.payload.recruitment_year_signal : candidate.payload.legal_signal,
            authority: "UNTRUSTED_OBSERVATION_NOT_ADMISSION", candidate_id: identity
          }, [observation, candidate]));
        }
      }
      if (directory.deferred.length) additions.push(createDiscoveryRecord("OBSERVATION", `discovery:deferred:${canonicalHash(intent.intent_id)}`, {
        request_state: "NOT_SENT", status: "BUDGET_FRONTIER_DEFERRED", deferred_count: directory.deferred.length,
        deferred_hash: canonicalHash(directory.deferred), deferred_frontier: directory.deferred, observed_at: at, run_id: this.options.run_id
      }));
      if (!directory.selected.length && !directory.deferred.length) status = "EMPTY";
    }
    this.finish(intent, status, at, length, response.response_set_cookie_present, additions,
      fixture ? {} : { http_status: response.http_status, content_sha256: response.content_sha256 });
  }

  private finish(intent: ReturnType<DiscoveryBudget["reserve"]>, status: string, at: string, length: number,
    cookiePresent: boolean, additions: DiscoveryRecord[] = [], facts: Record<string, unknown> = {}) {
    const sent = this.budget.snapshot().events.some(event => event.kind === "SENT" && event.intent_id === intent.intent_id);
    this.budget.observe(intent.intent_id, { status, byte_length: length }, at);
    const observation = createDiscoveryRecord("OBSERVATION", `discovery:response:${canonicalHash(intent.intent_id)}`, {
      intent_id: intent.intent_id, run_id: this.options.run_id, scope_hash: this.options.approved_scope_hash,
      exact_url: safeDiscoveryUrl(intent.url), request_state: sent ? "SENT" : "NOT_SENT", status, byte_length: length,
      response_set_cookie_present: cookiePresent, cookie_discarded: true, observed_at: at, provenance_kind: this.provenanceKind(), ...facts
    }, [this.options.store.restore(this.expectedHead).list("RUN").filter(record => record.logical_id === this.runIdentity()).at(-1)!]);
    this.persist("OBSERVED", at, [...additions, observation]);
  }
}

export function selectDueSeeds<Seed extends { id: string; next_due: string; unknown_signal: boolean }>(seeds: Seed[], at: string, limit: number): Seed[] {
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isFinite(Date.parse(at))) throw new Error("DISCOVERY_SELECTION_INVALID");
  const due = seeds.filter(seed => Number.isFinite(Date.parse(seed.next_due)) && Date.parse(seed.next_due) <= Date.parse(at))
    .sort((left, right) => left.next_due < right.next_due ? -1 : left.next_due > right.next_due ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const unknown = due.filter(seed => seed.unknown_signal).slice(0, Math.ceil(limit * 0.3));
  const chosen = new Set(unknown.map(seed => seed.id));
  return [...unknown, ...due.filter(seed => !chosen.has(seed.id)).slice(0, Math.max(0, limit - unknown.length))];
}
