import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";

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

export class DiscoveryBudget {
  private readonly policy: DiscoveryPolicy | null;
  private readonly requests = new Map<string, { organization: string; url: string; observed: boolean }>();
  private totalBytes = 0;
  private readonly cooldowns: Record<string, string>;
  private readonly started: number;

  constructor(policy: DiscoveryPolicy | null, startedAt: string, cooldowns: Record<string, string> = {}) {
    this.policy = structuredClone(policy);
    this.cooldowns = structuredClone(cooldowns);
    this.started = Date.parse(startedAt);
    if (!Number.isFinite(this.started)) throw new Error("DISCOVERY_TIME_INVALID");
    if (policy && (Object.values(policy.budget).some(value => !Number.isSafeInteger(value) || value < 0)
      || policy.budget.redirect_depth !== 0 || !policy.scope_id || !policy.approved_by || !policy.approval_reference)) {
      throw new Error("DISCOVERY_POLICY_INVALID");
    }
  }

  reserve(organization: string, url: string, at: string) {
    const policy = this.policy;
    const now = Date.parse(at);
    if (!policy || policy.status !== "ACTIVE" || !Number.isFinite(now)
      || !Number.isFinite(Date.parse(policy.effective_from)) || !Number.isFinite(Date.parse(policy.expires_at))
      || now < Date.parse(policy.effective_from) || now >= Date.parse(policy.expires_at)
      || now < this.started || now - this.started >= policy.budget.runtime_seconds * 1000) throw new Error("DISCOVERY_SCOPE_DENIED");
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password || target.hash
      || !policy.exact_urls.includes(url) || !/^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(target.hostname)
      || target.hostname.endsWith(".local") || /(?:token|secret|password|session|key)=/i.test(target.search)) {
      throw new Error("DISCOVERY_TARGET_DENIED");
    }
    const previous = this.cooldowns[organization];
    if (previous && (!Number.isFinite(Date.parse(previous)) || now - Date.parse(previous) < policy.budget.cooldown_seconds * 1000)) {
      throw new Error("DISCOVERY_COOLDOWN");
    }
    const requests = [...this.requests.values()];
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
    this.requests.set(intent.intent_id, { organization, url, observed: false });
    return intent;
  }

  observe(intentId: string, observation: { status: string; byte_length: number }, at: string): void {
    const request = this.requests.get(intentId);
    const length = observation.byte_length;
    if (!request || request.observed || !this.policy || !Number.isFinite(Date.parse(at))
      || !Number.isSafeInteger(length) || length < 0 || length > this.policy.budget.max_response_bytes
      || this.totalBytes + length > this.policy.budget.max_total_bytes) throw new Error("DISCOVERY_OBSERVATION_DENIED");
    this.totalBytes += length;
    request.observed = true;
  }
}
