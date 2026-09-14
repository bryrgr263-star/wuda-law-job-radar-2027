import { createHash } from "node:crypto";

import {
  OpportunityContractValidationError,
  type CanonicalOpportunity,
  type CanonicalOpportunityId,
  type CanonicalOpportunityIdentityBasis,
  type IdentityEvidence,
  type IdentityEvidenceId,
  type IdentityHash,
  type NonEmptyReadonlyArray,
  type OpportunityContent,
  type OpportunityVersionId,
  type Position,
  type PositionBoundOpportunityVersion,
  type PositionId,
  type PositionVersion,
  type RecruitmentBatchId,
  type RecruitmentIdentityClaim,
  type RecruitmentPlanId,
  type SemanticHash,
  type SourceOccurrenceVersionId
} from "../domain";
import { validatePositionBoundOpportunityVersion } from "../domain/opportunity";
import {
  validatePosition,
  validatePositionVersion
} from "../domain/recruitment-context";
import {
  resolvePositionIdentity,
  type PositionIdentityResolutionInput,
  type ValidatedPositionIdentitySource
} from "./position-identity-resolver";
import {
  CanonicalArtifactRegistryError,
  canonicalDeserialize,
  canonicalSerialize,
  createCanonicalArtifactRegistryAuthority
} from "./canonical-artifact-registry";
import {
  InMemoryPositionVersionTracker,
  PositionVersionTrackingError,
  resolveTrustedPositionVersionReadModel,
  type TrustedPositionVersionResolver
} from "./position-version-tracker";

export interface PositionBoundOpportunityTrackingInput {
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly sources: readonly PositionIdentityResolutionInput[];
}

export interface PositionBoundOpportunityTrackingResult {
  readonly canonical_opportunity: CanonicalOpportunity;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly canonical_created: boolean;
  readonly version_created: boolean;
}

export interface PositionBoundOpportunityArtifact {
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly canonical_opportunity: CanonicalOpportunity;
  readonly opportunity_version: PositionBoundOpportunityVersion;
}

export interface PositionBoundOpportunityGraphInput {
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly canonical_opportunity?: CanonicalOpportunity;
  readonly opportunity_version: PositionBoundOpportunityVersion;
}

export interface TrustedPositionBoundOpportunityGate {
  resolve(
    opportunityVersionId: OpportunityVersionId
  ): PositionBoundOpportunityArtifact | null;
}

export interface TrustedPositionBoundOpportunityResolver
  extends TrustedPositionBoundOpportunityGate {
  resolveSources(
    opportunityVersionId: OpportunityVersionId
  ): readonly PositionIdentityResolutionInput[] | null;
}

const trustedPositionBoundOpportunityResolvers = new WeakSet<object>();

export class PositionBoundOpportunityTrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionBoundOpportunityTrackingError";
  }
}

export class InMemoryPositionBoundOpportunityTracker
implements TrustedPositionBoundOpportunityResolver {
  readonly #positions = new Map<PositionId, Position>();
  readonly #opportunities = new Map<CanonicalOpportunityId, CanonicalOpportunity>();
  readonly #versions = new Map<CanonicalOpportunityId, PositionBoundOpportunityVersion[]>();
  readonly #sourceVersionHashes = new Map<SourceOccurrenceVersionId, SemanticHash>();
  readonly #sources = new Map<OpportunityVersionId, string>();
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    OpportunityVersionId,
    PositionBoundOpportunityArtifact
  >((artifact) => artifact.opportunity_version.opportunity_version_id);
  #positionVersionResolver: TrustedPositionVersionResolver | null;

  constructor(
    positionVersionResolver: TrustedPositionVersionResolver | null = null
  ) {
    this.#positionVersionResolver = positionVersionResolver;
    trustedPositionBoundOpportunityResolvers.add(this);
  }

  process(
    input: PositionBoundOpportunityTrackingInput
  ): PositionBoundOpportunityTrackingResult {
    if (!input?.position_version) {
      throw new PositionBoundOpportunityTrackingError(
        "Position-bound Opportunity materialization requires a PositionVersion"
      );
    }
    const callerPosition = validatePosition(input.position);
    validatePositionVersion(input.position_version, callerPosition);
    if (!this.#positionVersionResolver) {
      const trustedReadModel = resolveTrustedPositionVersionReadModel(
        input.position_version
      );
      if (!trustedReadModel) {
        throw new PositionBoundOpportunityTrackingError(
          "Position-bound Opportunity materialization requires a trusted PositionVersion resolver"
        );
      }
      this.#positionVersionResolver = trustedReadModel.resolver;
    }
    const trustedPositionVersion = this.#positionVersionResolver.resolve(
      input.position_version.position_version_id
    );
    if (!trustedPositionVersion) {
      throw new PositionBoundOpportunityTrackingError(
        "PositionVersion is not present in the trusted immutable registry"
      );
    }
    if (stableSerialize(input.position)
        !== stableSerialize(trustedPositionVersion.position)
        || stableSerialize(input.position_version)
          !== stableSerialize(trustedPositionVersion.position_version)) {
      throw new PositionBoundOpportunityTrackingError(
        "Caller PositionVersion must exactly match the trusted immutable artifact"
      );
    }
    const position = validatePosition(trustedPositionVersion.position);
    const positionVersion = validatePositionVersion(
      trustedPositionVersion.position_version,
      position
    );
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
      throw new PositionBoundOpportunityTrackingError(
        "Position-bound Opportunity materialization requires at least one validated SOV"
      );
    }

    const sources = uniqueSources(input.sources);
    validatePositionProjection(position, positionVersion, sources);
    validateSourceBindings(positionVersion, sources);
    validateSourceVersionIntegrity(
      uniqueSources(sources.flatMap(allValidatedSources)),
      this.#sourceVersionHashes
    );

    const identityProjections = sources.map((source) => {
      return opportunityIdentityProjection(position, source);
    });
    const identityCanonical = stableSerialize(identityProjections[0]!.basis);
    if (identityProjections.some((projection) => {
      return stableSerialize(projection.basis) !== identityCanonical;
    })) {
      throw new PositionBoundOpportunityTrackingError(
        "One materialization cannot combine distinct Opportunity identities"
      );
    }

    const opportunitySemantics = sources.map((source) => {
      return opportunitySemanticPayload(source.version.content);
    });
    const semanticCanonical = stableSerialize(opportunitySemantics[0]);
    if (opportunitySemantics.some((payload) => {
      return stableSerialize(payload) !== semanticCanonical;
    })) {
      throw new PositionBoundOpportunityTrackingError(
        "One OpportunityVersion cannot combine conflicting substantive Opportunity semantics"
      );
    }

    const basis = identityProjections[0]!.basis;
    const identityHash = sha256(identityCanonical) as IdentityHash;
    const canonicalOpportunityId = (
      `canonical-opportunity:${identityHash}`
    ) as CanonicalOpportunityId;
    const identityEvidenceIds = uniqueSorted(sources.flatMap((source) => {
      return source.version.identity_evidence.map((evidence: IdentityEvidence) => {
        return evidence.identity_evidence_id;
      });
    }));
    if (identityEvidenceIds.length === 0) {
      throw new PositionBoundOpportunityTrackingError(
        "CanonicalOpportunity requires traceable identity Evidence"
      );
    }
    const identityState = identityProjections.every((projection) => {
      return projection.confirmed;
    })
      ? "CONFIRMED"
      : "PROVISIONAL";
    const canonicalOpportunity = validateCanonicalOpportunity({
      canonical_opportunity_id: canonicalOpportunityId,
      identity_hash: identityHash,
      identity_state: identityState,
      identity_basis: basis,
      identity_evidence_ids: identityEvidenceIds,
      created_at: sources.map((source) => source.version.first_observed_at).sort()[0]!
    }, position);

    const existingPosition = this.#positions.get(position.position_id);
    if (existingPosition
        && (existingPosition.identity_hash !== position.identity_hash
          || existingPosition.identity_state !== position.identity_state)) {
      throw new PositionBoundOpportunityTrackingError(
        "Stored Position identity is immutable"
      );
    }
    const existingOpportunity = this.#opportunities.get(canonicalOpportunityId);
    if (existingOpportunity
        && (existingOpportunity.identity_hash !== identityHash
          || stableSerialize(existingOpportunity.identity_basis)
            !== stableSerialize(basis))) {
      throw new PositionBoundOpportunityTrackingError(
        "Stored CanonicalOpportunity identity is immutable"
      );
    }

    const existingVersions = this.#versions.get(canonicalOpportunityId) ?? [];
    validateHistory(
      existingVersions,
      existingOpportunity ?? canonicalOpportunity,
      existingPosition ?? position,
      this.#positionVersionResolver
    );
    const semanticHash = sha256(stableSerialize({
      canonical_opportunity_id: canonicalOpportunityId,
      opportunity: opportunitySemantics[0]
    })) as SemanticHash;
    const existingVersion = existingVersions.find((version) => {
      return version.semantic_hash === semanticHash;
    });
    if (existingVersion) {
      const artifact = this.#sealedArtifact(
        existingOpportunity ?? canonicalOpportunity,
        existingVersion,
        position,
        positionVersion,
        sources
      );
      this.#recordValidatedSources(sources.flatMap(allValidatedSources));
      return {
        canonical_opportunity: clone(artifact.canonical_opportunity),
        opportunity_version: clone(artifact.opportunity_version),
        canonical_created: false,
        version_created: false
      };
    }

    const revision = existingVersions.length + 1;
    const selectedSource = [...sources].sort((left, right) => {
      return left.version.source_occurrence_version_id.localeCompare(
        right.version.source_occurrence_version_id
      );
    })[0]!;
    const sourceOccurrenceVersionIds = asNonEmpty(uniqueSorted(sources.map((source) => {
      return source.version.source_occurrence_version_id;
    })));
    const opportunityVersionBinding = validatePositionBoundOpportunityVersion({
      opportunity_version_id: (
        `opportunity-version:${identityHash}:${revision}`
      ) as OpportunityVersionId,
      canonical_opportunity_id: canonicalOpportunityId,
      revision,
      semantic_hash: semanticHash,
      content: clone(selectedSource.version.content),
      source_occurrence_version_ids: sourceOccurrenceVersionIds,
      position_version_id: positionVersion.position_version_id,
      identity_evidence_ids: identityEvidenceIds,
      effective_from: sources.map((source) => source.version.first_observed_at).sort()[0]!
    }, position, positionVersion);
    const opportunityVersion: PositionBoundOpportunityVersion = {
      ...opportunityVersionBinding,
      integrity_hash: positionBoundOpportunityVersionIntegrityHash(
        opportunityVersionBinding
      ) as SemanticHash
    };
    assertPositionBoundOpportunityVersionIntegrity(
      opportunityVersion,
      position,
      positionVersion,
      canonicalOpportunity
    );

    const artifact = this.#sealedArtifact(
      existingOpportunity ?? canonicalOpportunity,
      opportunityVersion,
      position,
      positionVersion,
      sources
    );
    if (!existingOpportunity) {
      this.#positions.set(position.position_id, clone(position));
      this.#opportunities.set(canonicalOpportunityId, clone(canonicalOpportunity));
      this.#versions.set(canonicalOpportunityId, []);
    }
    this.#recordValidatedSources(sources.flatMap(allValidatedSources));
    this.#versions.get(canonicalOpportunityId)!.push(clone(opportunityVersion));
    return {
      canonical_opportunity: clone(artifact.canonical_opportunity),
      opportunity_version: clone(artifact.opportunity_version),
      canonical_created: !existingOpportunity,
      version_created: true
    };
  }

  resolve(opportunityVersionId: OpportunityVersionId) {
    const artifact = this.#registry.resolver.resolve(opportunityVersionId);
    return artifact
      ? assertPositionBoundOpportunityArtifactIntegrity(artifact)
      : null;
  }

  resolveSources(opportunityVersionId: OpportunityVersionId) {
    const canonicalBytes = this.#sources.get(opportunityVersionId);
    return canonicalBytes
      ? canonicalDeserialize<PositionIdentityResolutionInput[]>(canonicalBytes)
      : null;
  }

  getOpportunity(canonicalOpportunityId: CanonicalOpportunityId) {
    const opportunity = this.#opportunities.get(canonicalOpportunityId);
    return opportunity ? clone(opportunity) : null;
  }

  listVersions(canonicalOpportunityId: CanonicalOpportunityId) {
    return (this.#versions.get(canonicalOpportunityId) ?? []).map(clone);
  }

  #recordValidatedSources(sources: readonly ValidatedPositionIdentitySource[]) {
    for (const source of sources) {
      this.#sourceVersionHashes.set(
        source.version.source_occurrence_version_id,
        source.version.semantic_hash
      );
    }
  }

  #sealedArtifact(
    canonicalOpportunity: CanonicalOpportunity,
    opportunityVersion: PositionBoundOpportunityVersion,
    position: Position,
    positionVersion: PositionVersion,
    sources: readonly PositionIdentityResolutionInput[]
  ) {
    const artifact = assertPositionBoundOpportunityArtifactIntegrity({
      position: clone(position),
      position_version: clone(positionVersion),
      canonical_opportunity: clone(canonicalOpportunity),
      opportunity_version: clone(opportunityVersion)
    });
    const sourceBytes = canonicalSerialize(sources);
    const existingSourceBytes = this.#sources.get(
      opportunityVersion.opportunity_version_id
    );
    if (existingSourceBytes && existingSourceBytes !== sourceBytes) {
      throw new PositionBoundOpportunityTrackingError(
        `Position-bound Opportunity source provenance collision: ${opportunityVersion.opportunity_version_id}`
      );
    }
    try {
      const sealed = this.#registry.writer.seal(
        opportunityVersion.opportunity_version_id,
        artifact
      );
      if (!existingSourceBytes) {
        this.#sources.set(opportunityVersion.opportunity_version_id, sourceBytes);
      }
      return sealed.artifact;
    } catch (error) {
      if (error instanceof CanonicalArtifactRegistryError
          && error.code === "IDENTITY_COLLISION") {
        throw new PositionBoundOpportunityTrackingError(
          `Position-bound Opportunity identity collision: ${opportunityVersion.opportunity_version_id}`
        );
      }
      throw error;
    }
  }
}

export function assertTrustedPositionBoundOpportunityResolver(
  resolver: TrustedPositionBoundOpportunityResolver
): TrustedPositionBoundOpportunityResolver {
  if (!trustedPositionBoundOpportunityResolvers.has(resolver as object)
      || Object.getPrototypeOf(resolver)
        !== InMemoryPositionBoundOpportunityTracker.prototype) {
    throw new PositionBoundOpportunityTrackingError(
      "Trusted PBOV resolver must be created by the approved composition root"
    );
  }
  return resolver;
}

function validatePositionProjection(
  position: Position,
  positionVersion: PositionVersion,
  sources: readonly PositionIdentityResolutionInput[]
) {
  let projected: PositionVersion;
  try {
    projected = new InMemoryPositionVersionTracker().process({
      position,
      sources
    }).position_version;
  } catch (error) {
    if (error instanceof PositionVersionTrackingError) {
      throw new PositionBoundOpportunityTrackingError(error.message);
    }
    throw error;
  }
  if (projected.semantic_hash !== positionVersion.semantic_hash) {
    throw new PositionBoundOpportunityTrackingError(
      "PositionVersion semantics do not match the supplied validated SOVs"
    );
  }
}

function validateSourceBindings(
  positionVersion: PositionVersion,
  sources: readonly PositionIdentityResolutionInput[]
) {
  const boundSourceIds = new Set(positionVersion.source_occurrence_version_ids);
  if (sources.some((source) => {
    return !boundSourceIds.has(source.version.source_occurrence_version_id);
  })) {
    throw new PositionBoundOpportunityTrackingError(
      "Every Opportunity source must be bound to the supplied PositionVersion"
    );
  }
}

function opportunityIdentityProjection(
  position: Position,
  source: PositionIdentityResolutionInput
): {
  readonly basis: CanonicalOpportunityIdentityBasis;
  readonly confirmed: boolean;
} {
  const resolution = resolvePositionIdentity(source);
  if (resolution.status !== "RESOLVED"
      || resolution.position.position_id !== position.position_id
      || resolution.position.identity_hash !== position.identity_hash) {
    throw new PositionBoundOpportunityTrackingError(
      "Validated SOV identity does not match the supplied Position"
    );
  }
  const context = source.version.content.recruitment_context;
  if (!context) {
    throw new PositionBoundOpportunityTrackingError(
      "Legacy Opportunity input cannot create a Position-bound Opportunity"
    );
  }

  return {
    basis: opportunityIdentityBasisFromContent(position, source.version.content),
    confirmed: position.identity_state === "CONFIRMED"
      && context.opportunity.identity_state === "CONFIRMED"
  };
}

function opportunityIdentityBasisFromContent(
  position: Position,
  content: OpportunityContent
): CanonicalOpportunityIdentityBasis {
  const context = content.recruitment_context;
  if (!context) {
    throw new PositionBoundOpportunityTrackingError(
      "Legacy Opportunity input cannot create a Position-bound Opportunity"
    );
  }
  const recruitmentPlanId = entityIdForClaim(
    "recruitment-plan",
    context.recruitment_plan
  ) as RecruitmentPlanId | undefined;
  const recruitmentBatchId = context.recruitment_batch.applicability === "APPLICABLE"
    ? (entityIdForClaim(
        "recruitment-batch",
        context.recruitment_batch.identity
      ) as RecruitmentBatchId | undefined)
    : undefined;
  const officialOpportunityIdentityKey =
    context.opportunity.identity_state === "CONFIRMED"
      ? context.opportunity.identity_key
      : undefined;
  const hasClosedBatchContext =
    context.recruitment_batch.applicability === "NOT_APPLICABLE"
    || (context.recruitment_batch.applicability === "APPLICABLE"
      && recruitmentBatchId !== undefined);
  const sourceLocalPosition = position.identity_basis.kind === "SOURCE_LOCAL_RECORD";
  if (!officialOpportunityIdentityKey
      && !sourceLocalPosition
      && (!recruitmentPlanId || !hasClosedBatchContext)) {
    throw new PositionBoundOpportunityTrackingError(
      "Opportunity identity is unresolved for the supplied Position context"
    );
  }
  return {
    kind: "RECRUITMENT_CONTEXT",
    position_id: position.position_id,
    ...(recruitmentPlanId ? { recruitment_plan_id: recruitmentPlanId } : {}),
    ...(recruitmentBatchId ? { recruitment_batch_id: recruitmentBatchId } : {}),
    ...(officialOpportunityIdentityKey
      ? { official_opportunity_identity_key: officialOpportunityIdentityKey }
      : {})
  };
}

function entityIdForClaim(
  prefix: "recruitment-plan" | "recruitment-batch",
  claim: RecruitmentIdentityClaim
) {
  if (claim.identity_state === "UNRESOLVED") return undefined;
  return `${prefix}:${sha256(claim.identity_key)}`;
}

function opportunitySemanticPayload(content: OpportunityContent) {
  return {
    application_window: content.application_window
      ? {
          closes_on: content.application_window.closes_on ?? null,
          raw_text: content.application_window.raw_text?.text.trim() ?? null,
          starts_on: content.application_window.starts_on ?? null
        }
      : null,
    published_on: content.published_on ?? null,
    recruitment_batch: content.recruitment_batch
      ? semanticText(content.recruitment_batch)
      : null,
    recruitment_revision_relation_ids: uniqueSorted(
      content.recruitment_revision_relation_ids ?? []
    ),
    recruitment_year: content.recruitment_year ?? null
  };
}

function validateCanonicalOpportunity(
  opportunity: CanonicalOpportunity,
  position: Position
): CanonicalOpportunity {
  if (!opportunity.identity_basis
      || opportunity.identity_basis.kind !== "RECRUITMENT_CONTEXT") {
    throw new OpportunityContractValidationError(
      "New CanonicalOpportunity requires a Recruitment Context identity basis"
    );
  }
  if (opportunity.identity_basis.position_id !== position.position_id) {
    throw new OpportunityContractValidationError(
      "CanonicalOpportunity must reference the supplied Position"
    );
  }
  const expectedHash = sha256(
    stableSerialize(opportunity.identity_basis)
  ) as IdentityHash;
  const expectedId = `canonical-opportunity:${expectedHash}`;
  if (opportunity.identity_hash !== expectedHash
      || opportunity.canonical_opportunity_id !== expectedId) {
    throw new OpportunityContractValidationError(
      "CanonicalOpportunity identity must match its canonical identity basis"
    );
  }
  if (opportunity.identity_state !== "CONFIRMED"
      && opportunity.identity_state !== "PROVISIONAL") {
    throw new OpportunityContractValidationError(
      "Position-bound CanonicalOpportunity identity must be resolved or provisional"
    );
  }
  if (!opportunity.identity_evidence_ids?.length) {
    throw new OpportunityContractValidationError(
      "CanonicalOpportunity requires identity Evidence"
    );
  }
  if (!opportunity.created_at.trim()) {
    throw new OpportunityContractValidationError(
      "CanonicalOpportunity requires a creation time"
    );
  }
  return opportunity;
}

export function assertPositionBoundOpportunityVersionIntegrity(
  version: PositionBoundOpportunityVersion,
  position: Position,
  positionVersion: PositionVersion,
  opportunity?: CanonicalOpportunity
) {
  const validatedPosition = validatePosition(position);
  const validatedPositionVersion = validatePositionVersion(
    positionVersion,
    validatedPosition
  );
  validatePositionBoundOpportunityVersion(
    version,
    validatedPosition,
    validatedPositionVersion
  );
  const identityBasis = opportunityIdentityBasisFromContent(
    validatedPosition,
    version.content
  );
  const identityHash = sha256(stableSerialize(identityBasis)) as IdentityHash;
  const expectedCanonicalOpportunityId = `canonical-opportunity:${identityHash}`;
  if (version.canonical_opportunity_id !== expectedCanonicalOpportunityId) {
    throw new OpportunityContractValidationError(
      "OpportunityVersion canonical identity does not match Position and Recruitment Context"
    );
  }
  if (opportunity) {
    const validatedOpportunity = validateCanonicalOpportunity(
      opportunity,
      validatedPosition
    );
    if (validatedOpportunity.identity_hash !== identityHash
        || stableSerialize(validatedOpportunity.identity_basis)
          !== stableSerialize(identityBasis)) {
      throw new OpportunityContractValidationError(
        "CanonicalOpportunity does not match the OpportunityVersion identity projection"
      );
    }
  }
  if (opportunity
      && version.canonical_opportunity_id !== opportunity.canonical_opportunity_id) {
    throw new OpportunityContractValidationError(
      "OpportunityVersion must reference the supplied CanonicalOpportunity"
    );
  }
  if (!Number.isInteger(version.revision) || version.revision <= 0) {
    throw new OpportunityContractValidationError(
      "OpportunityVersion revision must be a positive integer"
    );
  }
  const expectedId = `opportunity-version:${identityHash}:${version.revision}`;
  if (version.opportunity_version_id !== expectedId) {
    throw new OpportunityContractValidationError(
      "OpportunityVersion identity must match Opportunity identity and revision"
    );
  }
  const expectedHash = sha256(stableSerialize({
    canonical_opportunity_id: version.canonical_opportunity_id,
    opportunity: opportunitySemanticPayload(version.content)
  }));
  const expectedIntegrityHash = positionBoundOpportunityVersionIntegrityHash(
    version
  );
  if (!Array.isArray(version.identity_evidence_ids)
      || version.identity_evidence_ids.length === 0
      || version.identity_evidence_ids.some((evidenceId) => !evidenceId.trim())
      || new Set(version.identity_evidence_ids).size
        !== version.identity_evidence_ids.length
      || new Set(version.source_occurrence_version_ids).size
        !== version.source_occurrence_version_ids.length
      || !version.effective_from?.trim()
      || Number.isNaN(Date.parse(version.effective_from))
      || !/^[a-f0-9]{64}$/u.test(version.semantic_hash)
      || !/^[a-f0-9]{64}$/u.test(version.integrity_hash)
      || version.semantic_hash !== expectedHash
      || version.integrity_hash !== expectedIntegrityHash) {
    throw new OpportunityContractValidationError(
      "OpportunityVersion semantic or immutable provenance integrity is invalid"
    );
  }
  if (opportunity
      && Date.parse(version.effective_from) < Date.parse(opportunity.created_at)) {
    throw new OpportunityContractValidationError(
      "OpportunityVersion cannot become effective before CanonicalOpportunity creation"
    );
  }
  return version;
}

export function assertPositionBoundOpportunityArtifactIntegrity(
  artifact: PositionBoundOpportunityArtifact
) {
  const position = validatePosition(artifact.position);
  const positionVersion = validatePositionVersion(
    artifact.position_version,
    position
  );
  const canonicalOpportunity = validateCanonicalOpportunity(
    artifact.canonical_opportunity,
    position
  );
  const opportunityVersion = assertPositionBoundOpportunityVersionIntegrity(
    artifact.opportunity_version,
    position,
    positionVersion,
    canonicalOpportunity
  );
  return {
    position,
    position_version: positionVersion,
    canonical_opportunity: canonicalOpportunity,
    opportunity_version: opportunityVersion
  };
}

export function assertPositionBoundOpportunityGraphMatchesTrustedArtifact(
  supplied: PositionBoundOpportunityGraphInput,
  trustedArtifact: PositionBoundOpportunityArtifact
) {
  const trusted = assertPositionBoundOpportunityArtifactIntegrity(trustedArtifact);
  const suppliedPosition = validatePosition(supplied.position);
  const suppliedPositionVersion = validatePositionVersion(
    supplied.position_version,
    suppliedPosition
  );
  const suppliedOpportunityVersion = assertPositionBoundOpportunityVersionIntegrity(
    supplied.opportunity_version,
    suppliedPosition,
    suppliedPositionVersion,
    supplied.canonical_opportunity
  );
  if (stableSerialize(suppliedPosition) !== stableSerialize(trusted.position)
      || stableSerialize(suppliedPositionVersion)
        !== stableSerialize(trusted.position_version)
      || stableSerialize(suppliedOpportunityVersion)
        !== stableSerialize(trusted.opportunity_version)
      || (supplied.canonical_opportunity
        && stableSerialize(supplied.canonical_opportunity)
          !== stableSerialize(trusted.canonical_opportunity))) {
    throw new OpportunityContractValidationError(
      "Caller-supplied Position-bound Opportunity graph does not match the trusted immutable artifact"
    );
  }
  return trusted;
}

type PositionBoundOpportunityVersionIntegrityInput = Omit<
  PositionBoundOpportunityVersion,
  "integrity_hash"
>;

export function positionBoundOpportunityVersionIntegrityHash(
  version: PositionBoundOpportunityVersion
    | PositionBoundOpportunityVersionIntegrityInput
) {
  return sha256(stableSerialize({
    opportunity_version_id: version.opportunity_version_id,
    canonical_opportunity_id: version.canonical_opportunity_id,
    revision: version.revision,
    semantic_hash: version.semantic_hash,
    content: version.content,
    source_occurrence_version_ids:
      uniqueSorted(version.source_occurrence_version_ids),
    position_version_id: version.position_version_id,
    identity_evidence_ids: uniqueSorted(version.identity_evidence_ids ?? []),
    effective_from: version.effective_from
  }));
}

function validateHistory(
  versions: readonly PositionBoundOpportunityVersion[],
  opportunity: CanonicalOpportunity,
  position: Position,
  positionVersionResolver: TrustedPositionVersionResolver
) {
  const revisions = new Set<number>();
  const hashes = new Set<SemanticHash>();
  for (const version of versions) {
    const positionVersionArtifact = positionVersionResolver.resolve(
      version.position_version_id
    );
    if (!positionVersionArtifact) {
      throw new PositionBoundOpportunityTrackingError(
        "Stored OpportunityVersion has an orphan PositionVersion binding"
      );
    }
    if (stableSerialize(positionVersionArtifact.position)
        !== stableSerialize(position)) {
      throw new PositionBoundOpportunityTrackingError(
        "Stored OpportunityVersion Position binding changed"
      );
    }
    assertPositionBoundOpportunityVersionIntegrity(
      version,
      position,
      positionVersionArtifact.position_version,
      opportunity
    );
    if (revisions.has(version.revision) || hashes.has(version.semantic_hash)) {
      throw new PositionBoundOpportunityTrackingError(
        "OpportunityVersion history must have unique revisions and semantics"
      );
    }
    revisions.add(version.revision);
    hashes.add(version.semantic_hash);
  }
  const ordered = [...revisions].sort((left, right) => left - right);
  if (ordered.some((revision, index) => revision !== index + 1)) {
    throw new PositionBoundOpportunityTrackingError(
      "OpportunityVersion history revisions must be contiguous"
    );
  }
}

function allValidatedSources(
  source: PositionIdentityResolutionInput
): readonly ValidatedPositionIdentitySource[] {
  return [source, ...(source.reconciliation?.related_sources ?? [])];
}

function uniqueSources<Source extends ValidatedPositionIdentitySource>(
  sources: readonly Source[]
): Source[] {
  const byId = new Map<SourceOccurrenceVersionId, Source>();
  for (const source of sources) {
    const sourceVersionId = source.version?.source_occurrence_version_id;
    if (!sourceVersionId) {
      resolvePositionIdentity(source as PositionIdentityResolutionInput);
    }
    const existing = byId.get(sourceVersionId);
    if (existing && existing.version.semantic_hash !== source.version.semantic_hash) {
      throw new PositionBoundOpportunityTrackingError(
        "One SOV ID cannot carry multiple semantic hashes"
      );
    }
    byId.set(sourceVersionId, source);
  }
  return [...byId.values()];
}

function validateSourceVersionIntegrity(
  sources: readonly ValidatedPositionIdentitySource[],
  existingHashes: ReadonlyMap<SourceOccurrenceVersionId, SemanticHash>
) {
  for (const source of sources) {
    const existingHash = existingHashes.get(
      source.version.source_occurrence_version_id
    );
    if (existingHash && existingHash !== source.version.semantic_hash) {
      throw new PositionBoundOpportunityTrackingError(
        "Previously observed SOV identity cannot be rebound to new semantics"
      );
    }
  }
}

function semanticText(value: {
  readonly original: { readonly text: string };
  readonly normalized?: { readonly text: string };
}) {
  return (value.normalized?.text ?? value.original.text).trim();
}

function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return stableSerialize(uniqueSorted(left)) === stableSerialize(uniqueSorted(right));
}

function asNonEmpty<Value>(
  values: readonly Value[]
): NonEmptyReadonlyArray<Value> {
  if (values.length === 0) {
    throw new PositionBoundOpportunityTrackingError(
      "A non-empty SOV binding is required"
    );
  }
  return values as NonEmptyReadonlyArray<Value>;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
