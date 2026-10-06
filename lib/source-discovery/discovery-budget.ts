import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";
import { safeDiscoveryUrl } from "./safety";

export interface DiscoveryPolicy {
  scope_id: string; revision: number; status: "ACTIVE" | "REVOKED";
  approved_by: string; approval_reference: string; effective_from: string; expires_at: string;
  exact_urls: string[];
  budget: {
    max_organizations: number; max_endpoints_per_organization: number; max_requests: number;
    max_candidate_urls: number; max_domains: number; redirect_depth: number; retry_limit: number;
    runtime_seconds: number; cooldown_seconds: number; max_response_bytes: number; max_total_bytes: number;
  };
}

type BudgetEvent =
  | { kind: "RESERVE"; organization: string; url: string; at: string; intent_id: string }
  | { kind: "SENT"; intent_id: string; at: string }
  | { kind: "OBSERVE"; intent_id: string; at: string; status: string; byte_length: number };
export interface DiscoveryBudgetSnapshot {
  policy: DiscoveryPolicy | null; started_at: string; cooldowns: Record<string, string>;
  events: BudgetEvent[]; integrity_hash: string;
}

export class DiscoveryBudget {
  private readonly policy: DiscoveryPolicy | null;
  private readonly requests = new Map<string, { organization: string; url: string; observed: boolean; sent: boolean; at: string }>();
  private readonly events: BudgetEvent[] = [];
  private totalBytes = 0;
  private readonly cooldowns: Record<string, string>;
  private readonly started: number;
  private readonly startedAt: string;

  constructor(policy: DiscoveryPolicy | null, startedAt: string, cooldowns: Record<string, string> = {}) {
    this.policy = structuredClone(policy);
    this.cooldowns = structuredClone(cooldowns);
    this.started = Date.parse(startedAt);
    this.startedAt = startedAt;
    if (!Number.isFinite(this.started)) throw new Error("DISCOVERY_TIME_INVALID");
    if (policy && (Object.values(policy.budget).some(value => !Number.isSafeInteger(value) || value < 0)
      || policy.budget.redirect_depth !== 0 || !policy.scope_id || !policy.approved_by || !policy.approval_reference)) {
      throw new Error("DISCOVERY_POLICY_INVALID");
    }
    if (policy) {
      const fields = new Set(["scope_id", "revision", "status", "approved_by", "approval_reference", "effective_from", "expires_at", "exact_urls", "budget"]);
      if (Object.keys(policy).some(key => !fields.has(key))) throw new Error("DISCOVERY_POLICY_INVALID");
      const caps = { max_organizations: 10, max_endpoints_per_organization: 2, max_requests: 32,
        max_candidate_urls: 40, max_domains: 8, redirect_depth: 0, retry_limit: 1,
        runtime_seconds: 600, max_response_bytes: 2097152, max_total_bytes: 16777216 };
      for (const key of Object.keys(caps) as (keyof typeof caps)[]) {
        if (!Number.isSafeInteger(policy.budget[key]) || policy.budget[key] > caps[key]) throw new Error("DISCOVERY_POLICY_INVALID");
      }
      if (policy.budget.cooldown_seconds < 86400 || !Number.isSafeInteger(policy.revision) || policy.revision < 1
        || !["ACTIVE", "REVOKED"].includes(policy.status) || !policy.exact_urls.length
        || new Set(policy.exact_urls).size !== policy.exact_urls.length) throw new Error("DISCOVERY_POLICY_INVALID");
      policy.exact_urls.forEach(safeDiscoveryUrl);
    }
  }

  reserve(organization: string, url: string, at: string) {
    const policy = this.policy;
    const now = Date.parse(at);
    if (!policy || policy.status !== "ACTIVE" || !Number.isFinite(now)
      || !Number.isFinite(Date.parse(policy.effective_from)) || !Number.isFinite(Date.parse(policy.expires_at))
      || now < Date.parse(policy.effective_from) || now >= Date.parse(policy.expires_at)
      || now < this.started || now - this.started >= policy.budget.runtime_seconds * 1000) throw new Error("DISCOVERY_SCOPE_DENIED");
    const target = new URL(safeDiscoveryUrl(url));
    if (!policy.exact_urls.includes(url)) {
      throw new Error("DISCOVERY_TARGET_DENIED");
    }
    const previous = [this.cooldowns[organization], this.cooldowns[`target:${canonicalHash(url)}`]].filter((value): value is string => !!value);
    if (previous.some(value => !Number.isFinite(Date.parse(value)) || now - Date.parse(value) < policy.budget.cooldown_seconds * 1000)) {
      throw new Error("DISCOVERY_COOLDOWN");
    }
    const requests = [...this.requests.values()];
    if (requests.some(request => !request.observed)) throw new Error("DISCOVERY_UNRESOLVED_RESERVATION");
    const completed = [...this.events].reverse().find(event => event.kind === "OBSERVE"
      && this.requests.get(event.intent_id)?.organization === organization && this.requests.get(event.intent_id)?.url === url);
    if (completed && now - Date.parse(completed.at) < (completed.kind === "OBSERVE" && completed.status === "NETWORK_FAILURE" ? 86400 : policy.budget.cooldown_seconds) * 1000) {
      throw new Error("DISCOVERY_COOLDOWN");
    }
    const organizations = new Set([...requests.map(request => request.organization), organization]);
    const endpoints = new Set([...requests.filter(request => request.organization === organization).map(request => request.url), url]);
    const domains = new Set([...requests.map(request => new URL(request.url).hostname), target.hostname]);
    if (!organization || this.requests.size >= policy.budget.max_requests
      || organizations.size > policy.budget.max_organizations || endpoints.size > policy.budget.max_endpoints_per_organization
      || domains.size > policy.budget.max_domains
      || requests.filter(request => request.url === url).length > policy.budget.retry_limit) throw new Error("DISCOVERY_BUDGET_EXHAUSTED");
    const intent = { intent_id: `discovery:intent:${canonicalHash({ scope: policy, organization, url, at, sequence: this.requests.size + 1 })}`,
      scope_id: policy.scope_id, scope_revision: policy.revision, organization, url, at,
      method: "GET" as const, credentials: "omit" as const, redirect: "manual" as const };
    this.requests.set(intent.intent_id, { organization, url, observed: false, sent: false, at });
    this.events.push({ kind: "RESERVE", organization, url, at, intent_id: intent.intent_id });
    return intent;
  }

  markSent(intentId: string, at: string): void {
    const request = this.requests.get(intentId);
    if (!request || request.sent || request.observed || !this.policy || !Number.isFinite(Date.parse(at))
      || Date.parse(at) < Date.parse(request.at) || Date.parse(at) >= Date.parse(this.policy.expires_at)
      || Date.parse(at) - this.started >= this.policy.budget.runtime_seconds * 1000) throw new Error("DISCOVERY_SEND_INVALID");
    request.sent = true;
    this.events.push({ kind: "SENT", intent_id: intentId, at });
  }

  observe(intentId: string, observation: { status: string; byte_length: number }, at: string): void {
    const request = this.requests.get(intentId);
    const length = observation.byte_length;
    if (!request || request.observed || !this.policy || !Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(request.at)
      || !["SUCCESS", "NETWORK_FAILURE", "ACCESS_BLOCKED", "REDIRECT_NOT_FOLLOWED", "UNSUPPORTED", "POLICY_DENIED", "UNAVAILABLE", "EMPTY"].includes(observation.status)
      || (!request.sent && observation.status !== "POLICY_DENIED")
      || !Number.isSafeInteger(length) || length < 0 || length > this.policy.budget.max_response_bytes
      || this.totalBytes + length > this.policy.budget.max_total_bytes) throw new Error("DISCOVERY_OBSERVATION_DENIED");
    this.totalBytes += length;
    request.observed = true;
    this.events.push({ kind: "OBSERVE", intent_id: intentId, at, status: observation.status, byte_length: length });
  }

  snapshot(): DiscoveryBudgetSnapshot {
    const content = { policy: structuredClone(this.policy), started_at: this.startedAt,
      cooldowns: structuredClone(this.cooldowns), events: structuredClone(this.events) };
    return { ...content, integrity_hash: canonicalHash(content) };
  }

  static restore(snapshot: DiscoveryBudgetSnapshot): DiscoveryBudget {
    const { integrity_hash: hash, ...content } = snapshot;
    if (canonicalHash(content) !== hash) throw new Error("DISCOVERY_BUDGET_INTEGRITY");
    const budget = new DiscoveryBudget(snapshot.policy, snapshot.started_at, snapshot.cooldowns);
    for (const event of snapshot.events) {
      if (event.kind === "RESERVE") {
        if (budget.reserve(event.organization, event.url, event.at).intent_id !== event.intent_id) throw new Error("DISCOVERY_INTENT_MISMATCH");
      } else if (event.kind === "SENT") budget.markSent(event.intent_id, event.at);
      else if (event.kind === "OBSERVE") budget.observe(event.intent_id, event, event.at);
      else throw new Error("DISCOVERY_EVENT_INVALID");
    }
    if (canonicalHash(budget.snapshot()) !== canonicalHash(snapshot)) throw new Error("DISCOVERY_REPLAY_MISMATCH");
    return budget;
  }
}
