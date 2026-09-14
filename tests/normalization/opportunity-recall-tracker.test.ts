import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  OpportunityRecallRegistryError,
  assertApprovedRecallExclusionPolicy,
  assertTrustedOpportunityCandidateResolver,
  assertTrustedRecallDispositionResolver,
  createApprovedRecallExclusionPolicyV1,
  createInMemoryOpportunityRecallBoundary,
  type ExtractedRecordId,
  type IsoDateTime,
  type OpportunityDiscoveryRegistrationInput,
  type PrePolicyRecallDispositionStatus,
  type RecruitmentEndpointId,
  type SnapshotId,
  type SourceDefinitionId,
  type SourceOccurrenceVersionId
} from "../../lib/ingestion";

const fullProvenance = {
  source_definition_id: "source-definition:recall-test" as SourceDefinitionId,
  recruitment_endpoint_id:
    "recruitment-endpoint:recall-test" as RecruitmentEndpointId,
  discovery_locator: "fixture://recall/row/1",
  snapshot_id: "snapshot:recall-test" as SnapshotId,
  extracted_record_id: "extracted-record:recall-test" as ExtractedRecordId,
  source_occurrence_version_id:
    "source-occurrence-version:recall-test:1" as SourceOccurrenceVersionId,
  publisher_subject: null,
  discovery_evidence_ids: ["discovery-evidence:row-1"],
  first_observed_at: "2026-09-14T08:00:00.000Z" as IsoDateTime
} as const;

test("every record entering Recall atomically receives Candidate and disposition", () => {
  const boundary = createInMemoryOpportunityRecallBoundary();
  const inputs: OpportunityDiscoveryRegistrationInput[] = [
    registration("RETAINED", fullProvenance),
    registration("IDENTITY_UNCERTAIN", {
      ...fullProvenance,
      discovery_locator: "fixture://recall/row/2",
      source_occurrence_version_id: null
    }),
    registration("PARSING_UNSUPPORTED", {
      ...fullProvenance,
      discovery_locator: "fixture://recall/attachment/unsupported",
      extracted_record_id: null,
      source_occurrence_version_id: null
    }),
    registration("ACQUISITION_UNSUPPORTED", {
      ...fullProvenance,
      discovery_locator: "https://official.example.test/dynamic",
      snapshot_id: null,
      extracted_record_id: null,
      source_occurrence_version_id: null
    }),
    registration("EVIDENCE_BLOCKED", {
      ...fullProvenance,
      discovery_locator: "fixture://recall/missing-attachment",
      extracted_record_id: null,
      source_occurrence_version_id: null
    }),
    registration("REVIEW_REQUIRED", {
      ...fullProvenance,
      discovery_locator: "fixture://recall/review",
      source_occurrence_version_id: null
    })
  ];

  const results = inputs.map((input) => boundary.register(input));
  assert.equal(results.length, inputs.length);
  for (const result of results) {
    assert.deepEqual(
      boundary.candidates.resolve(result.candidate.opportunity_candidate_id),
      result.candidate
    );
    assert.deepEqual(
      boundary.dispositions.resolve(result.disposition.recall_disposition_id),
      result.disposition
    );
    assert.deepEqual(
      boundary.dispositions.resolveCurrent(result.candidate.opportunity_candidate_id),
      result.disposition
    );
    assert.notEqual(result.disposition.status, "EXCLUDED");
  }
});

test("registration is canonical, idempotent, and collision rejecting", () => {
  const boundary = createInMemoryOpportunityRecallBoundary();
  const input = registration("RETAINED", fullProvenance);
  const first = boundary.register(input);
  const second = boundary.register({
    ...input,
    discovery_evidence_ids: [...input.discovery_evidence_ids].reverse(),
    initial_disposition: {
      ...input.initial_disposition,
      reason_codes: [...input.initial_disposition.reason_codes].reverse(),
      evidence_ids: [...input.initial_disposition.evidence_ids].reverse()
    }
  });
  assert.equal(first.registration_status, "SEALED");
  assert.equal(second.registration_status, "IDEMPOTENT_REUSE");
  assert.deepEqual(second.candidate, first.candidate);
  assert.deepEqual(second.disposition, first.disposition);

  assert.throws(() => boundary.register(registration("RETAINED", {
    ...fullProvenance,
    snapshot_id: "snapshot:changed-canonical-provenance" as SnapshotId
  })), (error: unknown) => {
    return error instanceof OpportunityRecallRegistryError
      && error.code === "IDENTITY_COLLISION";
  });
});

test("RecallDisposition revisions are append-only and exact replay is idempotent", () => {
  const boundary = createInMemoryOpportunityRecallBoundary();
  const registered = boundary.register(registration("REVIEW_REQUIRED", fullProvenance));
  const command = {
    opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
    status: "IDENTITY_UNCERTAIN" as const,
    reason_codes: ["POSITION_IDENTITY_UNRESOLVED"],
    evidence_ids: ["identity-evidence:unresolved-position"],
    decided_at: "2026-09-14T09:00:00.000Z" as IsoDateTime
  };
  const changed = boundary.recordDisposition(command);
  const replay = boundary.recordDisposition(command);

  assert.equal(changed.version_created, true);
  assert.equal(changed.disposition.revision, 2);
  assert.equal(
    changed.disposition.supersedes_recall_disposition_id,
    registered.disposition.recall_disposition_id
  );
  assert.equal(replay.version_created, false);
  assert.deepEqual(replay.disposition, changed.disposition);
  assert.deepEqual(
    boundary.dispositions.list(registered.candidate.opportunity_candidate_id),
    [registered.disposition, changed.disposition]
  );
  assert.deepEqual(
    boundary.dispositions.resolve(registered.disposition.recall_disposition_id),
    registered.disposition
  );
});

test("resolvers return defensive snapshots and reject resolver-shaped callers", () => {
  const boundary = createInMemoryOpportunityRecallBoundary();
  const registered = boundary.register(registration("RETAINED", fullProvenance));
  const candidate = boundary.candidates.resolve(
    registered.candidate.opportunity_candidate_id
  )!;
  const disposition = boundary.dispositions.resolve(
    registered.disposition.recall_disposition_id
  )!;
  (candidate.discovery_evidence_ids as string[]).push("caller-mutation");
  (disposition.reason_codes as string[]).push("caller-mutation");

  assert.deepEqual(
    boundary.candidates.resolve(registered.candidate.opportunity_candidate_id),
    registered.candidate
  );
  assert.deepEqual(
    boundary.dispositions.resolve(registered.disposition.recall_disposition_id),
    registered.disposition
  );
  assert.equal(
    assertTrustedOpportunityCandidateResolver(boundary.candidates),
    boundary.candidates
  );
  assert.equal(
    assertTrustedRecallDispositionResolver(boundary.dispositions),
    boundary.dispositions
  );
  assert.throws(() => assertTrustedOpportunityCandidateResolver({ resolve: () => null }),
    OpportunityRecallRegistryError);
  assert.throws(() => assertTrustedRecallDispositionResolver({
    resolve: () => null,
    resolveCurrent: () => null,
    list: () => []
  }), OpportunityRecallRegistryError);
});

test("caller eligibility and scoring fields cannot enter Recall artifacts", () => {
  const boundary = createInMemoryOpportunityRecallBoundary();
  const input = {
    ...registration("RETAINED", fullProvenance),
    candidate_profile_id: "candidate-profile:forged",
    candidate_evidence_id: "candidate-evidence:forged",
    eligibility_assessment_id: "eligibility:forged",
    match_score: 5,
    non_law_rule: "要求本科法学"
  } as OpportunityDiscoveryRegistrationInput & Record<string, unknown>;
  const serialized = JSON.stringify(boundary.register(input));

  assert.doesNotMatch(
    serialized,
    /candidate_profile_id|candidate_evidence_id|eligibility_assessment_id|match_score|non_law_rule/u
  );
});

test("EXCLUDED requires an installed approved policy and cannot be caller supplied", () => {
  const input = registration("REVIEW_REQUIRED", fullProvenance);
  const boundary = createInMemoryOpportunityRecallBoundary();
  assert.throws(() => boundary.register({
    ...input,
    initial_disposition: {
      ...input.initial_disposition,
      status: "EXCLUDED" as never
    }
  }), (error: unknown) => {
    return error instanceof OpportunityRecallRegistryError
      && error.code === "EXCLUSION_POLICY_NOT_AVAILABLE";
  });
  assert.throws(() => boundary.recordApprovedExclusion({
    opportunity_candidate_id: boundary.register(input).candidate.opportunity_candidate_id,
    decided_at: "2026-09-14T09:00:00.000Z" as IsoDateTime
  }), (error: unknown) => {
    return error instanceof OpportunityRecallRegistryError
      && error.code === "EXCLUSION_POLICY_NOT_AVAILABLE";
  });
  assert.throws(() => createInMemoryOpportunityRecallBoundary({
    exclusion_policy: {
      policy_id: "caller-policy",
      policy_version: "1.0.0"
    }
  }), OpportunityRecallRegistryError);
  assert.throws(() => assertApprovedRecallExclusionPolicy({
    policy_id: "caller-policy",
    policy_version: "1.0.0"
  }), OpportunityRecallRegistryError);
});

test("approved exact construction subject exclusion is versioned and evidenced", () => {
  const policy = createApprovedRecallExclusionPolicyV1();
  const boundary = createInMemoryOpportunityRecallBoundary({
    exclusion_policy: policy
  });
  const registered = boundary.register(registration("REVIEW_REQUIRED", {
    ...fullProvenance,
    publisher_subject: {
      subject_identity: "organization:中国建筑集团有限公司",
      subject_display_name: "中国建筑集团有限公司",
      evidence_id: "source-registry-evidence:cscec"
    },
    discovery_evidence_ids: [
      ...fullProvenance.discovery_evidence_ids,
      "source-registry-evidence:cscec"
    ]
  }));
  const excluded = boundary.recordApprovedExclusion({
    opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
    decided_at: "2026-09-14T09:00:00.000Z" as IsoDateTime
  });

  assert.equal(excluded.disposition.status, "EXCLUDED");
  assert.deepEqual(excluded.disposition.evidence_ids, [
    "source-registry-evidence:cscec"
  ]);
  assert.equal(excluded.disposition.exclusion_rule?.policy_version, "1.0.0");
  assert.equal(
    excluded.disposition.exclusion_rule?.reason_code,
    "PRODUCT_SCOPE_EXCLUDED_CONSTRUCTION_SUBJECT"
  );
  assert.equal(boundary.dispositions.list(
    registered.candidate.opportunity_candidate_id
  ).length, 2);
});

test("vague construction words and ordinary subjects cannot be excluded", () => {
  const boundary = createInMemoryOpportunityRecallBoundary({
    exclusion_policy: createApprovedRecallExclusionPolicyV1()
  });
  for (const [index, subject] of [
    "某工程技术有限公司",
    "某项目运营有限公司",
    "某建设咨询有限公司"
  ].entries()) {
    const registered = boundary.register(registration("REVIEW_REQUIRED", {
      ...fullProvenance,
      discovery_locator: `fixture://recall/vague/${index}`,
      publisher_subject: {
        subject_identity: `organization:${subject}`,
        subject_display_name: subject,
        evidence_id: `source-registry-evidence:vague-${index}`
      },
      discovery_evidence_ids: [
        ...fullProvenance.discovery_evidence_ids,
        `source-registry-evidence:vague-${index}`
      ]
    }));
    assert.throws(() => boundary.recordApprovedExclusion({
      opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
      decided_at: "2026-09-14T09:00:00.000Z" as IsoDateTime
    }), (error: unknown) => {
      return error instanceof OpportunityRecallRegistryError
        && error.code === "EXCLUSION_NOT_APPROVED";
    });
    assert.equal(boundary.dispositions.resolveCurrent(
      registered.candidate.opportunity_candidate_id
    )?.status, "REVIEW_REQUIRED");
  }
});

test("attachment, year, title, and professional ambiguity remain retained dispositions", () => {
  const boundary = createInMemoryOpportunityRecallBoundary();
  const ambiguities = [
    ["EVIDENCE_BLOCKED", "ATTACHMENT_MISSING"],
    ["REVIEW_REQUIRED", "YEAR_UNKNOWN"],
    ["REVIEW_REQUIRED", "TITLE_AMBIGUOUS"],
    ["REVIEW_REQUIRED", "PROFESSIONAL_SCOPE_AMBIGUOUS"]
  ] as const;

  ambiguities.forEach(([status, reason], index) => {
    const input = registration(status, {
      ...fullProvenance,
      discovery_locator: `fixture://recall/ambiguity/${index}`
    });
    const result = boundary.register({
      ...input,
      initial_disposition: {
        ...input.initial_disposition,
        reason_codes: [reason]
      }
    });
    assert.notEqual(result.disposition.status, "EXCLUDED");
    assert.deepEqual(result.disposition.reason_codes, [reason]);
  });
});

function registration(
  status: PrePolicyRecallDispositionStatus,
  provenance: Omit<OpportunityDiscoveryRegistrationInput, "initial_disposition">
): OpportunityDiscoveryRegistrationInput {
  return {
    ...provenance,
    initial_disposition: {
      status,
      reason_codes: [`RECALL_${status}`],
      evidence_ids: provenance.discovery_evidence_ids,
      decided_at: provenance.first_observed_at
    }
  };
}
