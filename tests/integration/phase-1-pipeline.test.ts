import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ConservativeCanonicalizer,
  DeterministicEligibilityEngine,
  DeterministicRequirementParser,
  FixtureAdapter,
  FixtureTransport,
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  InMemorySourceOccurrenceTracker,
  InMemorySourceRegistry,
  RawCaptureService,
  SourceRunMissingGuard,
  SqliteShadowPersistence,
  UTF8_TEXT_ENCODING,
  type AdapterCompletenessAssessment,
  type AdapterRequestPlan,
  type CandidateProfile,
  type CandidateProfileId,
  type ExtractedRecord,
  type IsoDateTime,
  type Organization,
  type OrganizationId,
  type RawBlob,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type RequirementEvidenceFragmentId,
  type Snapshot,
  type SnapshotId,
  type SourceDefinition,
  type SourceDefinitionId,
  type SourceOccurrenceProcessingResult,
  type SourceRunId,
  type TransportRequest
} from "../../lib/ingestion";
import { createMigratedShadowDatabase } from "../persistence/shadow-test-database";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "fixtures", "adapters");
const requestedAt = branded<IsoDateTime>("2026-09-02T08:00:00+08:00");
const observedAt = branded<IsoDateTime>("2026-09-02T08:00:01+08:00");

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

interface SourceFixture {
  readonly organization: Organization;
  readonly source: SourceDefinition;
  readonly endpoint: RecruitmentEndpoint;
}

interface CollectionResult {
  readonly snapshots: readonly Snapshot[];
  readonly raw_blobs: readonly RawBlob[];
  readonly records: readonly ExtractedRecord[];
  readonly completeness: AdapterCompletenessAssessment;
}

function sourceFixture(
  key: string,
  contentKind: RecruitmentEndpoint["content_kind"],
  locator: string,
  organizationName: string,
  publisherKind: SourceDefinition["publisher_kind"],
  authorityLevel: SourceDefinition["authority_level"]
): SourceFixture {
  const organizationId = branded<OrganizationId>(`organization-${key}`);
  const sourceDefinitionId = branded<SourceDefinitionId>(`source-${key}`);
  return {
    organization: {
      organization_id: organizationId,
      name: traceable(organizationName),
      aliases: [],
      country_code: "CN"
    },
    source: {
      source_definition_id: sourceDefinitionId,
      publisher_organization_id: organizationId,
      name: traceable(`${organizationName}招聘来源`),
      publisher_kind: publisherKind,
      authority_level: authorityLevel,
      scope: publisherKind === "THIRD_PARTY_PLATFORM" ? "NATIONAL" : "SINGLE_ORGANIZATION",
      enabled: true
    },
    endpoint: {
      recruitment_endpoint_id: branded<RecruitmentEndpointId>(`endpoint-${key}`),
      source_definition_id: sourceDefinitionId,
      name: traceable(`${contentKind} Fixture Endpoint`),
      description: traceable("仅用于 Phase 1 离线闭环验收"),
      coverage_regions: [{ raw_text: original("全国") }],
      locator,
      content_kind: contentKind,
      adapter_key: "fixture",
      decoded_text_encoding: UTF8_TEXT_ENCODING,
      collection_config: { max_pages: 3, max_items: 100 },
      enabled: true
    }
  };
}

const locators = {
  html: "fixture://phase-1/official-html.html",
  changedHtml: "fixture://phase-1/official-html-changed.html",
  jsonPage1: "fixture://phase-1/paged-json-1.json",
  jsonPage2: "fixture://phase-1/paged-json-2.json",
  document: "fixture://phase-1/document-preprocessed.txt",
  empty: "fixture://phase-1/empty.json"
} as const;

const fixtures = {
  html: sourceFixture(
    "official-html",
    "HTML",
    locators.html,
    "中国科学院某研究所",
    "RESEARCH_INSTITUTE",
    "OFFICIAL"
  ),
  json: sourceFixture(
    "third-party-json",
    "JSON",
    locators.jsonPage1,
    "全国招聘信息 Fixture 发布者",
    "THIRD_PARTY_PLATFORM",
    "THIRD_PARTY"
  ),
  document: sourceFixture(
    "government-document",
    "PDF",
    locators.document,
    "某市事业单位",
    "GOVERNMENT_PORTAL",
    "OFFICIAL"
  )
} as const;

function fixtureBytes(fileName: string) {
  return new Uint8Array(readFileSync(path.join(fixtureRoot, fileName)));
}

function createTransport() {
  const htmlBytes = fixtureBytes("official-html.html");
  const changedHtmlBytes = new TextEncoder().encode(
    new TextDecoder("utf-8", { fatal: true }).decode(htmlBytes).replace(
      "负责合同审查、法律咨询与诉讼管理。",
      "负责合同审查、法律咨询、诉讼管理与合规培训。"
    )
  );
  return new FixtureTransport([
    {
      locator: locators.html,
      bytes: htmlBytes,
      mime_type: "text/html; charset=utf-8"
    },
    {
      locator: locators.changedHtml,
      bytes: changedHtmlBytes,
      mime_type: "text/html; charset=utf-8"
    },
    {
      locator: locators.jsonPage1,
      bytes: fixtureBytes("paged-json-1.json"),
      mime_type: "application/json; charset=utf-8",
      headers: { "x-fixture-next-locator": locators.jsonPage2 }
    },
    {
      locator: locators.jsonPage2,
      bytes: fixtureBytes("paged-json-2.json"),
      mime_type: "application/json; charset=utf-8"
    },
    {
      locator: locators.document,
      bytes: fixtureBytes("document-preprocessed.txt"),
      mime_type: "text/plain; charset=utf-8"
    },
    {
      locator: locators.empty,
      bytes: fixtureBytes("empty.json"),
      mime_type: "application/json; charset=utf-8"
    }
  ], { now: () => observedAt });
}

function createRegistry(sourceFixtures: readonly SourceFixture[]) {
  const registry = new InMemorySourceRegistry();
  registry.registerAdapterKey({
    adapter_key: "fixture",
    name: traceable("FixtureAdapter"),
    supported_content_kinds: ["HTML", "JSON", "PDF", "FILE"]
  });
  for (const item of sourceFixtures) {
    registry.registerOrganization(item.organization);
    registry.registerSourceDefinition(item.source);
    registry.registerRecruitmentEndpoint(item.endpoint);
  }
  return registry;
}

function transportRequest(plan: AdapterRequestPlan): TransportRequest {
  return {
    recruitment_endpoint_id: plan.recruitment_endpoint_id,
    locator: plan.locator,
    method: plan.method,
    requested_at: requestedAt,
    headers: {},
    parameters: plan.parameters
  };
}

async function collect(
  endpoint: RecruitmentEndpoint,
  transport = createTransport(),
  rawBlobs = new InMemoryRawBlobRepository(),
  snapshots = new InMemorySnapshotRepository(),
  snapshotNamespace = "collection"
): Promise<CollectionResult & {
  readonly raw_repository: InMemoryRawBlobRepository;
  readonly snapshot_repository: InMemorySnapshotRepository;
}> {
  const adapter = new FixtureAdapter();
  let snapshotSequence = 0;
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => branded<SnapshotId>(
      `${endpoint.recruitment_endpoint_id}:${snapshotNamespace}:snapshot:${++snapshotSequence}`
    )
  });
  const collectedSnapshots: Snapshot[] = [];
  const collectedRawBlobs: RawBlob[] = [];
  const records: ExtractedRecord[] = [];
  const extractionErrors: Array<{
    snapshot_id: SnapshotId;
    code: string;
    message: string;
  }> = [];

  let plan: AdapterRequestPlan | null = adapter.plan(endpoint)[0] ?? null;
  while (plan) {
    const request = transportRequest(plan);
    const response = await transport.execute(request);
    const captured = capture.record(request, response);
    collectedSnapshots.push(captured.snapshot);
    if (captured.raw_blob) {
      collectedRawBlobs.push(captured.raw_blob);
      try {
        records.push(...adapter.extract({
          endpoint,
          snapshot: captured.snapshot,
          raw_blob: captured.raw_blob
        }));
      } catch (error) {
        extractionErrors.push({
          snapshot_id: captured.snapshot.snapshot_id,
          code: error instanceof Error ? error.name : "UNKNOWN_EXTRACTION_ERROR",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    plan = adapter.nextPage({
      endpoint,
      snapshot: captured.snapshot,
      pagination_state: plan.pagination_state
    });
  }

  return {
    snapshots: collectedSnapshots,
    raw_blobs: collectedRawBlobs,
    records,
    completeness: adapter.assessCompleteness({
      snapshots: collectedSnapshots,
      records,
      extraction_errors: extractionErrors
    }),
    raw_repository: rawBlobs,
    snapshot_repository: snapshots
  };
}

function candidate(): CandidateProfile {
  return {
    candidate_profile_id: branded<CandidateProfileId>("candidate-wuhan-jm-non-law-2027"),
    education: [
      {
        level: "BACHELOR",
        institution: traceable("示例本科院校"),
        program_name: traceable("经济学"),
        normalized_program_codes: [],
        academic_background: "NON_LAW",
        graduation_year: 2024
      },
      {
        level: "MASTER",
        institution: traceable("武汉大学"),
        program_name: traceable("法律硕士（非法学）"),
        normalized_program_codes: ["JURIS_MASTER", "JURIS_MASTER_NON_LAW"],
        academic_background: "NON_LAW",
        graduation_year: 2027
      }
    ],
    target_graduation_year: 2027,
    professional_qualifications: [],
    languages: []
  };
}

function track(
  tracker: InMemorySourceOccurrenceTracker,
  endpoint: RecruitmentEndpoint,
  records: readonly ExtractedRecord[]
) {
  return records.map((record) => tracker.process(endpoint, record));
}

test("one Fixture Source reaches Eligibility when explicit requirements are complete", async () => {
  const registry = createRegistry([fixtures.html]);
  const endpoint = registry.listCollectableEndpoints()[0];
  const collection = await collect(endpoint);

  assert.equal(collection.raw_repository.count(), 1);
  assert.equal(collection.snapshot_repository.count(), 1);
  assert.equal(collection.completeness.status, "COMPLETE");
  assert.ok(collection.records.length > 0);
  assert.equal(collection.records[0].snapshot_id, collection.snapshots[0].snapshot_id);
  assert.equal(collection.snapshots[0].raw_blob_id, collection.raw_blobs[0].raw_blob_id);

  const tracked = track(new InMemorySourceOccurrenceTracker(), endpoint, [collection.records[0]])[0];
  const canonicalized = new ConservativeCanonicalizer().canonicalize([{
    occurrence: tracked.occurrence,
    version: tracked.version,
    source_definition: fixtures.html.source
  }], { organizations: [fixtures.html.organization] }).opportunities[0];
  const requirementText = canonicalized.opportunity_version.content.requirement_text;
  assert.ok(requirementText?.normalized);
  const requirementLocator = collection.records[0].source_record_locator;
  assert.equal(requirementLocator.kind, "HTML");
  if (requirementLocator.kind !== "HTML") {
    throw new Error("Expected the HTML Fixture locator");
  }
  const requirementFragment = {
    requirement_evidence_fragment_id: branded<RequirementEvidenceFragmentId>(
      "phase-1-html-requirement-fragment"
    ),
    extracted_record_id: collection.records[0].extracted_record_id,
    snapshot_id: collection.records[0].snapshot_id,
    locator: {
      kind: "HTML" as const,
      selector: requirementLocator.selector,
      path: requirementLocator.path,
      field_path: "raw_requirement_text"
    },
    observed_value_state: "TEXT" as const,
    original_text: requirementText.original,
    normalized_text: requirementText.normalized,
    extractor_name: collection.records[0].extraction.extractor_name,
    extractor_version: collection.records[0].extraction.extractor_version,
    parser_version: "requirement-fragment-contract/1.0.0"
  };
  const requirements = new DeterministicRequirementParser().parse({
    opportunity_version: canonicalized.opportunity_version,
    evidence_fragments: [requirementFragment],
    expected_sources: [{
      extracted_record_id: requirementFragment.extracted_record_id,
      snapshot_id: requirementFragment.snapshot_id
    }]
  });
  assert.ok(requirements.facts.length > 0);
  assert.equal(requirements.facts.length, requirements.evidence.length);
  assert.equal(requirements.evidence[0].snapshot_id, collection.snapshots[0].snapshot_id);
  assert.match(requirements.evidence[0].evidence_text.text, /法律硕士/);
  assert.equal(requirements.completeness.status, "COMPLETE");
  assert.notEqual(requirements.complete_requirement_set, null);

  const profile = candidate();
  const assessment = new DeterministicEligibilityEngine().evaluate({
    opportunity_version: canonicalized.opportunity_version,
    complete_requirement_set: requirements.complete_requirement_set!,
    candidate_profile: profile,
    assessed_at: observedAt
  });
  assert.equal(assessment.result, "ELIGIBLE");

  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistence.organizations.append(fixtures.html.organization);
  persistence.source_definitions.append(fixtures.html.source);
  persistence.recruitment_endpoints.append(endpoint);
  persistence.source_occurrences.append(tracked.occurrence);
  persistence.source_occurrence_versions.append(tracked.version);
  persistence.canonical_opportunities.append(canonicalized.canonical_opportunity);
  persistence.opportunity_versions.append(canonicalized.opportunity_version);
  for (const fact of requirements.facts) persistence.requirement_facts.append(fact);
  for (const evidence of requirements.evidence) {
    persistence.requirement_evidence.append(evidence);
  }
  persistence.candidate_profiles.append(profile);
  assert.equal(
    persistence.requirement_evidence.get(requirements.evidence[0].requirement_evidence_id)
      ?.evidence_text.text,
    requirements.evidence[0].evidence_text.text
  );
  database.close();
});

test("HTML, paged JSON, and document Fixtures converge on one source model", async () => {
  const registry = createRegistry([fixtures.html, fixtures.json, fixtures.document]);
  const tracker = new InMemorySourceOccurrenceTracker();
  const results = await Promise.all(registry.listCollectableEndpoints().map(async (endpoint) => {
    const collection = await collect(endpoint);
    return {
      endpoint,
      collection,
      tracked: track(tracker, endpoint, collection.records)
    };
  }));

  assert.deepEqual(results.map((result) => result.collection.records.length), [2, 2, 1]);
  assert.deepEqual(results.map((result) => result.collection.snapshots.length), [1, 2, 1]);
  assert.ok(results.every((result) => result.collection.completeness.status === "COMPLETE"));
  assert.deepEqual(
    results.flatMap((result) => result.collection.records).map((record) => {
      return record.source_record_locator.kind;
    }),
    ["HTML", "HTML", "JSON", "JSON", "DOCUMENT"]
  );
  assert.equal(tracker.listOccurrences().length, 5);
  assert.ok(results.flatMap((result) => result.tracked).every((item) => {
    return item.version.content.title.original.encoding === UTF8_TEXT_ENCODING
      && item.version.content.locations.length > 0;
  }));
});

test("repeat collection reuses RawBlob, Occurrence, and semantic Version", async () => {
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = await collect(
    fixtures.html.endpoint,
    createTransport(),
    rawBlobs,
    snapshots,
    "first"
  );
  const firstTracked = tracker.process(fixtures.html.endpoint, first.records[0]);
  const second = await collect(
    fixtures.html.endpoint,
    createTransport(),
    rawBlobs,
    snapshots,
    "second"
  );
  const secondTracked = tracker.process(fixtures.html.endpoint, second.records[0]);

  assert.equal(rawBlobs.count(), 1);
  assert.equal(snapshots.count(), 2);
  assert.equal(secondTracked.occurrence_created, false);
  assert.equal(secondTracked.version_created, false);
  assert.equal(secondTracked.occurrence.source_occurrence_id,
    firstTracked.occurrence.source_occurrence_id);
  assert.equal(secondTracked.version.source_occurrence_version_id,
    firstTracked.version.source_occurrence_version_id);
});

test("semantic content change creates a Version without creating lifecycle state", async () => {
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = await collect(fixtures.html.endpoint);
  const changedEndpoint: RecruitmentEndpoint = {
    ...fixtures.html.endpoint,
    locator: locators.changedHtml
  };
  const changedCollection = await collect(changedEndpoint);
  const firstTracked = tracker.process(fixtures.html.endpoint, first.records[0]);
  const changed = tracker.process(changedEndpoint, changedCollection.records[0]);

  assert.notEqual(changedCollection.snapshots[0].content_hash,
    first.snapshots[0].content_hash);
  assert.equal(changed.occurrence.source_occurrence_id,
    firstTracked.occurrence.source_occurrence_id);
  assert.equal(changed.occurrence_created, false);
  assert.equal(changed.version_created, true);
  assert.equal(changed.version.revision, 2);
  assert.notEqual(changed.version.semantic_hash, firstTracked.version.semantic_hash);
  assert.equal("event_kind" in changed.version, false);
});

test("failed and suspicious-empty runs never emit missing lifecycle events", async () => {
  const known = track(
    new InMemorySourceOccurrenceTracker(),
    fixtures.html.endpoint,
    (await collect(fixtures.html.endpoint)).records
  ).map((item: SourceOccurrenceProcessingResult) => item.occurrence);
  const guard = new SourceRunMissingGuard();
  const failedEndpoint: RecruitmentEndpoint = {
    ...fixtures.html.endpoint,
    locator: "fixture://phase-1/missing.html"
  };
  const failedCollection = await collect(failedEndpoint);
  const failedRun = guard.assessRun({
    source_run_id: branded<SourceRunId>("source-run-failed"),
    source_definition_id: fixtures.html.source.source_definition_id,
    recruitment_endpoint_id: fixtures.html.endpoint.recruitment_endpoint_id,
    started_at: requestedAt,
    completed_at: observedAt,
    snapshots: failedCollection.snapshots,
    collection_completeness: failedCollection.completeness,
    observed_source_occurrence_ids: [],
    not_modified: false
  });
  const failedMissing = guard.guardMissing({
    source_run: failedRun,
    known_source_occurrences: known,
    previous_missing_streaks: {}
  });

  const emptyEndpoint: RecruitmentEndpoint = {
    ...fixtures.json.endpoint,
    locator: locators.empty
  };
  const emptyCollection = await collect(emptyEndpoint);
  const emptyRun = guard.assessRun({
    source_run_id: branded<SourceRunId>("source-run-suspicious-empty"),
    source_definition_id: fixtures.json.source.source_definition_id,
    recruitment_endpoint_id: fixtures.json.endpoint.recruitment_endpoint_id,
    started_at: requestedAt,
    completed_at: observedAt,
    snapshots: emptyCollection.snapshots,
    collection_completeness: emptyCollection.completeness,
    observed_source_occurrence_ids: [],
    not_modified: false
  });

  assert.equal(failedRun.status, "FAILED");
  assert.equal(failedMissing.lifecycle_events.length, 0);
  assert.equal(emptyRun.status, "SUSPICIOUS_EMPTY");
  assert.equal(emptyRun.missing_updates_allowed, false);
});

test("the Phase 1 integration path remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
