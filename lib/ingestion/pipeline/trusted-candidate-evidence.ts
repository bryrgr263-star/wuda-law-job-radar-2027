import { createHash } from "node:crypto";

import type {
  CandidateCredentialId,
  CandidateProfileId,
  CandidateCredentialProvenance,
  CandidateStateObservationStatus,
  IsoDateTime,
  NormalizedText,
  OriginalText,
  StructuredCandidateProfile,
  StructuredEducationCredential
} from "../domain";
import {
  CanonicalArtifactRegistryError,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import {
  assertPredicateCandidateEvidenceIntegrity,
  createPredicateCandidateEvidence,
  type PredicateCandidateEvidence,
  type PredicateCandidateEvidenceProvenance,
  type PredicateCandidateEvidenceSourceReference,
  type PredicateCandidateEvidenceValue
} from "./position-bound-predicate-resolution";

export interface CandidateProfileEvidenceMaterializationCommand {
  readonly candidate_profile: StructuredCandidateProfile;
  readonly observed_at: IsoDateTime;
  readonly effective_from?: IsoDateTime;
  readonly effective_to?: IsoDateTime;
}

export interface TrustedCandidateEvidenceBatch {
  readonly candidate_profile_id: CandidateProfileId;
  readonly provenance: PredicateCandidateEvidenceProvenance;
  readonly evidence_ids: readonly string[];
  readonly evidence: readonly PredicateCandidateEvidence[];
}

export const CANDIDATE_EVIDENCE_SOURCE_MANIFEST_SCHEMA_VERSION =
  "candidate-evidence-source-manifest/1.0.0" as const;

export interface CandidateEvidenceSourceManifest {
  readonly candidate_evidence_source_manifest_id: string;
  readonly manifest_stream_id: string;
  readonly candidate_profile_id: CandidateProfileId;
  readonly evidence_class: "CANDIDATE_ASSERTED" | "DOCUMENT_VERIFIED";
  readonly scope: "PRODUCTION" | "SYNTHETIC_TEST";
  readonly revision: number;
  readonly supersedes_manifest_id: string | null;
  readonly locator: {
    readonly kind: "CANDIDATE_CLAIM" | "PRIVATE_OBJECT_STORAGE";
    readonly value: string;
  };
  readonly evidence_object: {
    readonly bucket_id: string;
    readonly object_key: string;
    readonly sha256: string;
    readonly byte_length: number;
    readonly content_type: string;
  } | null;
  readonly verifier: {
    readonly identity: string;
    readonly role: string;
    readonly method: string;
    readonly verified_at: IsoDateTime;
  } | null;
  readonly actor: string;
  readonly issued_at: IsoDateTime;
  readonly provenance_references: readonly string[];
  readonly schema_version: typeof CANDIDATE_EVIDENCE_SOURCE_MANIFEST_SCHEMA_VERSION;
  readonly integrity_hash: string;
}

export type CandidateEvidenceSourceManifestInput = Omit<
  CandidateEvidenceSourceManifest,
  "candidate_evidence_source_manifest_id" | "schema_version" | "integrity_hash"
>;

export interface CandidateEvidenceIssuanceItem {
  readonly candidate_credential_id?: CandidateCredentialId;
  readonly value: PredicateCandidateEvidenceValue | null;
  readonly original_value: OriginalText;
  readonly normalized_value: NormalizedText;
  readonly observation_status: CandidateStateObservationStatus;
  readonly observed_at: IsoDateTime;
  readonly effective_from?: IsoDateTime;
  readonly effective_to?: IsoDateTime;
}

export interface IssueCandidateEvidenceCommand {
  readonly source_manifest: CandidateEvidenceSourceManifest;
  readonly evidence: readonly CandidateEvidenceIssuanceItem[];
}

export interface TrustedCandidateEvidenceSourceVerifier {
  verify(manifest: CandidateEvidenceSourceManifest): Promise<void>;
}

export interface CandidateEvidenceIssuanceResult extends TrustedCandidateEvidenceBatch {
  readonly source_manifest: CandidateEvidenceSourceManifest;
}

export interface TrustedCandidateEvidenceResolver {
  resolve(candidateEvidenceId: string): PredicateCandidateEvidence | null;
}

const trustedCandidateEvidenceResolvers = new WeakSet<object>();

export class TrustedCandidateEvidenceError extends Error {
  readonly code:
    | "INVALID_PROFILE"
    | "INVALID_ISSUANCE"
    | "IDENTITY_COLLISION"
    | "UNSUPPORTED_AUTHORITY";

  constructor(code: TrustedCandidateEvidenceError["code"], message: string) {
    super(message);
    this.name = "TrustedCandidateEvidenceError";
    this.code = code;
  }
}

export class InMemoryTrustedCandidateEvidenceTracker
implements TrustedCandidateEvidenceResolver {
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    string,
    PredicateCandidateEvidence
  >((artifact) => artifact.predicate_candidate_evidence_id);
  readonly #manifestRegistry = createCanonicalArtifactRegistryAuthority<
    string,
    CandidateEvidenceSourceManifest
  >((artifact) => artifact.candidate_evidence_source_manifest_id);
  readonly #manifestVersions = new Map<string, CandidateEvidenceSourceManifest[]>();

  constructor() {
    trustedCandidateEvidenceResolvers.add(this);
  }

  materializeClaimedProfile(
    command: CandidateProfileEvidenceMaterializationCommand
  ): TrustedCandidateEvidenceBatch {
    return this.#materialize(command, "CANDIDATE_ASSERTED");
  }

  materializeSyntheticFixture(
    command: CandidateProfileEvidenceMaterializationCommand
  ): TrustedCandidateEvidenceBatch {
    return this.#materialize(command, "SYNTHETIC_TEST");
  }

  issue(command: IssueCandidateEvidenceCommand): CandidateEvidenceIssuanceResult {
    const manifest = assertCandidateEvidenceSourceManifestIntegrity(
      command.source_manifest
    );
    if (command.evidence.length === 0) {
      throw new TrustedCandidateEvidenceError(
        "INVALID_ISSUANCE",
        "Candidate Evidence issuance requires at least one evidence item"
      );
    }
    const candidates = command.evidence.map((item) => {
      if (item.value?.kind === "EDUCATION_CREDENTIAL"
          && item.value.credential.provenance !== manifest.evidence_class) {
        throw new TrustedCandidateEvidenceError(
          "INVALID_ISSUANCE",
          "Education credential provenance must match the issuance manifest"
        );
      }
      return assertPredicateCandidateEvidenceIntegrity(
        createPredicateCandidateEvidence({
          candidate_profile_id: manifest.candidate_profile_id,
          ...(item.candidate_credential_id ? {
            candidate_credential_id: item.candidate_credential_id
          } : {}),
          value: structuredClone(item.value),
          original_value: structuredClone(item.original_value),
          normalized_value: structuredClone(item.normalized_value),
          observation_status: item.observation_status,
          observed_at: item.observed_at,
          ...(item.effective_from ? { effective_from: item.effective_from } : {}),
          ...(item.effective_to ? { effective_to: item.effective_to } : {}),
          provenance: manifest.evidence_class,
          source_references: [{
            candidate_state_evidence_id:
              manifest.candidate_evidence_source_manifest_id as
                PredicateCandidateEvidenceSourceReference["candidate_state_evidence_id"],
            evidence_class: manifest.evidence_class,
            captured_at: manifest.issued_at,
            issuer: manifest.verifier?.identity ?? manifest.actor
          }]
        })
      );
    });
    const sealedManifest = this.#sealManifest(manifest);
    const evidence = candidates.map((candidate) => {
      try {
        return this.#registry.writer.seal(
          candidate.predicate_candidate_evidence_id,
          candidate
        ).artifact;
      } catch (error) {
        if (error instanceof CanonicalArtifactRegistryError
            && error.code === "IDENTITY_COLLISION") {
          throw new TrustedCandidateEvidenceError(
            "IDENTITY_COLLISION",
            `Candidate Evidence identity collision: ${candidate.predicate_candidate_evidence_id}`
          );
        }
        throw error;
      }
    });
    return structuredClone({
      source_manifest: sealedManifest,
      candidate_profile_id: manifest.candidate_profile_id,
      provenance: manifest.evidence_class,
      evidence_ids: evidence.map((item) => item.predicate_candidate_evidence_id),
      evidence
    });
  }

  resolve(candidateEvidenceId: string) {
    const evidence = this.#registry.resolver.resolve(candidateEvidenceId);
    return evidence ? assertPredicateCandidateEvidenceIntegrity(evidence) : null;
  }

  #sealManifest(manifest: CandidateEvidenceSourceManifest) {
    const existing = this.#manifestRegistry.resolver.resolve(
      manifest.candidate_evidence_source_manifest_id
    );
    if (existing) return assertCandidateEvidenceSourceManifestIntegrity(existing);
    const versions = this.#manifestVersions.get(manifest.manifest_stream_id) ?? [];
    const previous = versions.at(-1) ?? null;
    if (manifest.revision !== versions.length + 1
        || manifest.supersedes_manifest_id
          !== (previous?.candidate_evidence_source_manifest_id ?? null)) {
      throw new TrustedCandidateEvidenceError(
        "INVALID_ISSUANCE",
        "Candidate Evidence manifest revision is not append-only or contiguous"
      );
    }
    const sealed = this.#manifestRegistry.writer.seal(
      manifest.candidate_evidence_source_manifest_id,
      manifest
    ).artifact;
    this.#manifestVersions.set(manifest.manifest_stream_id, [
      ...versions,
      structuredClone(sealed)
    ]);
    return sealed;
  }

  #materialize(
    command: CandidateProfileEvidenceMaterializationCommand,
    provenance: Exclude<PredicateCandidateEvidenceProvenance, "DOCUMENT_VERIFIED">
  ): TrustedCandidateEvidenceBatch {
    validateProfile(command.candidate_profile);
    const candidates = projectProfileEvidence(command, provenance);
    const evidence = candidates.map((candidate) => {
      try {
        return this.#registry.writer.seal(
          candidate.predicate_candidate_evidence_id,
          candidate
        ).artifact;
      } catch (error) {
        if (error instanceof CanonicalArtifactRegistryError
            && error.code === "IDENTITY_COLLISION") {
          throw new TrustedCandidateEvidenceError(
            "IDENTITY_COLLISION",
            `Candidate Evidence identity collision: ${candidate.predicate_candidate_evidence_id}`
          );
        }
        throw error;
      }
    });
    return {
      candidate_profile_id: command.candidate_profile.candidate_profile_id,
      provenance,
      evidence_ids: evidence.map((item) => item.predicate_candidate_evidence_id),
      evidence: structuredClone(evidence)
    };
  }
}

export function createCandidateEvidenceSourceManifest(
  input: CandidateEvidenceSourceManifestInput
): CandidateEvidenceSourceManifest {
  const base = {
    ...structuredClone(input),
    provenance_references: [...input.provenance_references].sort(),
    schema_version: CANDIDATE_EVIDENCE_SOURCE_MANIFEST_SCHEMA_VERSION
  };
  const integrityHash = `sha256:${sha256(stableSerialize(base))}`;
  return assertCandidateEvidenceSourceManifestIntegrity({
    ...base,
    candidate_evidence_source_manifest_id:
      `candidate-evidence-source:${integrityHash.slice(7)}`,
    integrity_hash: integrityHash
  });
}

export function assertCandidateEvidenceSourceManifestIntegrity(
  manifest: CandidateEvidenceSourceManifest
) {
  if (manifest.schema_version !== CANDIDATE_EVIDENCE_SOURCE_MANIFEST_SCHEMA_VERSION
      || !manifest.manifest_stream_id.trim()
      || !manifest.candidate_profile_id.trim()
      || !manifest.actor.trim()
      || !manifest.locator.value.trim()
      || !Number.isSafeInteger(manifest.revision)
      || manifest.revision < 1
      || (manifest.revision === 1) !== (manifest.supersedes_manifest_id === null)) {
    throw new TrustedCandidateEvidenceError(
      "INVALID_ISSUANCE",
      "Candidate Evidence source manifest identity or revision is invalid"
    );
  }
  const documentVerified = manifest.evidence_class === "DOCUMENT_VERIFIED";
  if (documentVerified !== (manifest.evidence_object !== null)
      || documentVerified !== (manifest.verifier !== null)
      || documentVerified !== (manifest.locator.kind === "PRIVATE_OBJECT_STORAGE")) {
    throw new TrustedCandidateEvidenceError(
      "INVALID_ISSUANCE",
      "DOCUMENT_VERIFIED requires one private evidence object and verifier"
    );
  }
  if (manifest.evidence_object) {
    if (!/^[a-f0-9]{64}$/u.test(manifest.evidence_object.sha256)
        || manifest.evidence_object.byte_length < 1
        || !manifest.evidence_object.bucket_id.trim()
        || !manifest.evidence_object.object_key.trim()
        || !manifest.evidence_object.content_type.trim()) {
      throw new TrustedCandidateEvidenceError(
        "INVALID_ISSUANCE",
        "Candidate evidence object metadata is incomplete"
      );
    }
  }
  if (manifest.verifier && (!manifest.verifier.identity.trim()
      || !manifest.verifier.role.trim()
      || !manifest.verifier.method.trim())) {
    throw new TrustedCandidateEvidenceError(
      "INVALID_ISSUANCE",
      "Candidate evidence verifier metadata is incomplete"
    );
  }
  const {
    candidate_evidence_source_manifest_id: ignoredId,
    integrity_hash: ignoredHash,
    ...withoutIdentity
  } = manifest;
  const expectedHash = `sha256:${sha256(stableSerialize(withoutIdentity))}`;
  if (manifest.integrity_hash !== expectedHash
      || manifest.candidate_evidence_source_manifest_id
        !== `candidate-evidence-source:${expectedHash.slice(7)}`) {
    throw new TrustedCandidateEvidenceError(
      "INVALID_ISSUANCE",
      "Candidate Evidence source manifest integrity mismatch"
    );
  }
  return structuredClone(manifest);
}

export function assertTrustedCandidateEvidenceResolver(
  resolver: TrustedCandidateEvidenceResolver
) {
  if (!trustedCandidateEvidenceResolvers.has(resolver as object)
      || Object.getPrototypeOf(resolver)
        !== InMemoryTrustedCandidateEvidenceTracker.prototype) {
    throw new TrustedCandidateEvidenceError(
      "UNSUPPORTED_AUTHORITY",
      "Trusted Candidate Evidence resolver must be composition-root controlled"
    );
  }
  return resolver;
}

function projectProfileEvidence(
  command: CandidateProfileEvidenceMaterializationCommand,
  provenance: Exclude<PredicateCandidateEvidenceProvenance, "DOCUMENT_VERIFIED">
) {
  const profile = command.candidate_profile;
  const values: Array<{
    readonly value: PredicateCandidateEvidenceValue;
    readonly candidateCredentialId?: CandidateCredentialId;
    readonly original: string;
  }> = profile.education.map((credential) => ({
    value: {
      kind: "EDUCATION_CREDENTIAL" as const,
      credential: credentialForProvenance(credential, provenance)
    },
    candidateCredentialId: credential.candidate_credential_id,
    original: credential.program_name.original.text
  }));

  if (profile.target_graduation_year !== undefined) {
    values.push({
      value: {
        kind: "TARGET_GRADUATION_YEAR",
        graduation_year: profile.target_graduation_year
      },
      original: String(profile.target_graduation_year)
    });
  }
  for (const cohort of profile.candidate_cohorts ?? []) {
    values.push({
      value: { kind: "CANDIDATE_COHORT", candidate_cohort: cohort },
      original: cohort
    });
  }
  if (profile.gender !== undefined) {
    values.push({ value: { kind: "GENDER", gender: profile.gender }, original: profile.gender });
  }
  if (profile.date_of_birth !== undefined) {
    values.push({
      value: { kind: "DATE_OF_BIRTH", date_of_birth: profile.date_of_birth },
      original: profile.date_of_birth
    });
  }
  for (const qualification of profile.professional_qualifications) {
    values.push({
      value: { kind: "PROFESSIONAL_QUALIFICATION", qualification },
      original: qualification.name.original.text
    });
  }
  for (const experience of profile.work_experience ?? []) {
    values.push({
      value: { kind: "WORK_EXPERIENCE", work_experience: experience },
      original: `${experience.years}:${experience.scope}`
    });
  }

  return values.map((item, index) => {
    const reference = sourceReference(
      profile.candidate_profile_id,
      item.value.kind,
      item.candidateCredentialId,
      command.observed_at,
      provenance,
      index
    );
    return createPredicateCandidateEvidence({
      candidate_profile_id: profile.candidate_profile_id,
      ...(item.candidateCredentialId ? {
        candidate_credential_id: item.candidateCredentialId
      } : {}),
      value: item.value,
      original_value: { text: item.original, encoding: "UTF-8" },
      normalized_value: {
        text: item.original.normalize("NFKC"),
        unicode_form: "NFKC",
        normalizer_version: "candidate-profile-evidence-adapter/1.0.0",
        operations: ["UNICODE_NORMALIZATION"]
      },
      observation_status: provenance === "SYNTHETIC_TEST"
        ? "CONFIRMED"
        : "INSUFFICIENT",
      observed_at: command.observed_at,
      ...(command.effective_from ? { effective_from: command.effective_from } : {}),
      ...(command.effective_to ? { effective_to: command.effective_to } : {}),
      provenance,
      source_references: [reference]
    });
  });
}

function credentialForProvenance(
  credential: StructuredEducationCredential,
  provenance: CandidateCredentialProvenance
): StructuredEducationCredential {
  return structuredClone({ ...credential, provenance });
}

function sourceReference(
  candidateProfileId: CandidateProfileId,
  valueKind: PredicateCandidateEvidenceValue["kind"],
  candidateCredentialId: CandidateCredentialId | undefined,
  observedAt: IsoDateTime,
  provenance: Exclude<PredicateCandidateEvidenceProvenance, "DOCUMENT_VERIFIED">,
  index: number
): PredicateCandidateEvidenceSourceReference {
  const identity = sha256(stableSerialize({
    candidate_profile_id: candidateProfileId,
    candidate_credential_id: candidateCredentialId ?? null,
    value_kind: valueKind,
    observed_at: observedAt,
    provenance,
    index
  }));
  return {
    candidate_state_evidence_id:
      `candidate-evidence-source:${identity}` as PredicateCandidateEvidenceSourceReference[
        "candidate_state_evidence_id"
      ],
    evidence_class: provenance,
    captured_at: observedAt,
    issuer: provenance === "SYNTHETIC_TEST"
      ? "synthetic-candidate-fixture"
      : "candidate-profile-claim"
  };
}

function validateProfile(profile: StructuredCandidateProfile) {
  if (!profile.candidate_profile_id.trim() || profile.education.length === 0) {
    throw new TrustedCandidateEvidenceError(
      "INVALID_PROFILE",
      "Candidate Evidence requires an identified structured CandidateProfile"
    );
  }
  const credentialIds = profile.education.map((credential) => {
    return credential.candidate_credential_id;
  });
  if (credentialIds.some((id) => !id.trim())
      || new Set(credentialIds).size !== credentialIds.length) {
    throw new TrustedCandidateEvidenceError(
      "INVALID_PROFILE",
      "Candidate credentials require unique non-empty identities"
    );
  }
  for (const credential of profile.education) {
    if (!credential.institution.original.text.trim()
        || !credential.program_name.original.text.trim()
        || credential.major_identity_assertion.credential_level
          !== credential.level) {
      throw new TrustedCandidateEvidenceError(
        "INVALID_PROFILE",
        "Candidate credential identity, institution, program, and level must remain explicit"
      );
    }
  }
  if (profile.target_graduation_year !== undefined
      && (!Number.isSafeInteger(profile.target_graduation_year)
        || profile.target_graduation_year < 1900)) {
    throw new TrustedCandidateEvidenceError(
      "INVALID_PROFILE",
      "Candidate target graduation year is invalid"
    );
  }
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
