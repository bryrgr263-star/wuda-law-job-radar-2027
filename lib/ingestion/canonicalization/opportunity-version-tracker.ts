import type {
  CanonicalOpportunity,
  CanonicalOpportunityId,
  OpportunityVersion,
  OpportunityVersionId
} from "../domain";
import type { CanonicalizedOpportunity } from "./types";

export interface CanonicalOpportunityVersionTrackingResult {
  readonly canonical_opportunity: CanonicalOpportunity;
  readonly opportunity_version: OpportunityVersion;
  readonly canonical_created: boolean;
  readonly version_created: boolean;
}

export class CanonicalOpportunityVersionTrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalOpportunityVersionTrackingError";
  }
}

export class InMemoryCanonicalOpportunityVersionTracker {
  readonly #opportunities = new Map<CanonicalOpportunityId, CanonicalOpportunity>();
  readonly #versions = new Map<CanonicalOpportunityId, OpportunityVersion[]>();

  process(
    projection: CanonicalizedOpportunity
  ): CanonicalOpportunityVersionTrackingResult {
    const incomingOpportunity = projection.canonical_opportunity;
    const incomingVersion = projection.opportunity_version;
    if (incomingVersion.canonical_opportunity_id
        !== incomingOpportunity.canonical_opportunity_id) {
      throw new CanonicalOpportunityVersionTrackingError(
        "OpportunityVersion must reference the supplied CanonicalOpportunity"
      );
    }

    const existingOpportunity = this.#opportunities.get(
      incomingOpportunity.canonical_opportunity_id
    );
    if (existingOpportunity
        && existingOpportunity.identity_hash !== incomingOpportunity.identity_hash) {
      throw new CanonicalOpportunityVersionTrackingError(
        "CanonicalOpportunity identity hash is immutable"
      );
    }
    const canonicalOpportunity = existingOpportunity ?? clone(incomingOpportunity);
    if (!existingOpportunity) {
      this.#opportunities.set(
        canonicalOpportunity.canonical_opportunity_id,
        canonicalOpportunity
      );
      this.#versions.set(canonicalOpportunity.canonical_opportunity_id, []);
    }

    const versions = this.#versions.get(canonicalOpportunity.canonical_opportunity_id)!;
    const latest = versions[versions.length - 1];
    if (latest?.semantic_hash === incomingVersion.semantic_hash) {
      return {
        canonical_opportunity: clone(canonicalOpportunity),
        opportunity_version: clone(latest),
        canonical_created: false,
        version_created: false
      };
    }

    const revision = versions.length + 1;
    const version: OpportunityVersion = {
      ...clone(incomingVersion),
      opportunity_version_id: (
        `opportunity-version:${canonicalOpportunity.identity_hash}:${revision}`
      ) as OpportunityVersionId,
      canonical_opportunity_id: canonicalOpportunity.canonical_opportunity_id,
      revision
    };
    versions.push(version);
    return {
      canonical_opportunity: clone(canonicalOpportunity),
      opportunity_version: clone(version),
      canonical_created: !existingOpportunity,
      version_created: true
    };
  }

  getOpportunity(canonicalOpportunityId: CanonicalOpportunityId) {
    const opportunity = this.#opportunities.get(canonicalOpportunityId);
    return opportunity ? clone(opportunity) : null;
  }

  listVersions(canonicalOpportunityId: CanonicalOpportunityId) {
    return (this.#versions.get(canonicalOpportunityId) ?? []).map(clone);
  }
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
