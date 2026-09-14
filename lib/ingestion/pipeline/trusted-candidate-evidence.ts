import { createHash } from "node:crypto";

import type {
  CandidateCredentialId,
  CandidateProfileId,
  CandidateCredentialProvenance,
  IsoDateTime,
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

export interface TrustedCandidateEvidenceResolver {
  resolve(candidateEvidenceId: string): PredicateCandidateEvidence | null;
}

const trustedCandidateEvidenceResolvers = new WeakSet<object>();

export class TrustedCandidateEvidenceError extends Error {
  readonly code:
    | "INVALID_PROFILE"
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

  resolve(candidateEvidenceId: string) {
    const evidence = this.#registry.resolver.resolve(candidateEvidenceId);
    return evidence ? assertPredicateCandidateEvidenceIntegrity(evidence) : null;
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
