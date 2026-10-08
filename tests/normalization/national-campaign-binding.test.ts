import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrapTrustedChainCompositionRoot, createExtractedRecordV2,
  type TrustedChainCommand, type TrustedRestorationExecution } from "../../lib/ingestion";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import type { SOVDiscoveryEvidence } from "../../lib/ingestion/normalization/source-discovery-support";
import { AS_OF, trustedFixture } from "../pipeline/position-bound-phase-fixture";
import { Chnenergy2027HtmlAdapter, CHNENERGY_JOBS, chnenergyEndpoint } from "../../lib/production-sources/chnenergy-2027-source";

const adapterKey = "cn-chnenergy-2027-reviewed-official-html";
const campaignId = "6a152f40-7fe5-460e-ad37-0024acafd8c9";
const jobId = "5a798bfe-a4d6-0be4-e063-98b4d40a088a";
const origin = "https://zhaopin.chnenergy.com.cn";
const campaignUrl = `${origin}/annc/showgg?id=${campaignId}`;
const membershipUrl = `${origin}/annc/showggStationList?id=${campaignId}&zhaopingangwei=%E6%B3%95%E5%8A%A1%E7%AE%A1%E7%90%86`;
const jobUrl = `${origin}/annc/showgw?id=${jobId}`;
const text = (value: string) => ({ text: value, encoding: "UTF-8" as const });
const campaignHtml = `<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p><p>毕业生年龄计算的截止时间为2027年7月31日。</p><a href="/annc/showggStationList?id=${campaignId}">招聘岗位</a>`;
const memberHtml = `<form id="annclistform" action="/annc/showggStationList" method="post"><input type="hidden" name="id" value="${campaignId}"></form><ul class="list-group"><li class="list-group-item"><h4 class="list-group-item-heading"><a href="/annc/showgw?id=${jobId}">法务管理</a></h4><span>TEST_ONLY...</span></li></ul>`;
const detailHtml = `<title>岗位详情</title><div><h4 class="listTitle">岗位基本信息</h4></div><ul><li>招聘单位：TEST_ONLY单位</li><li>招聘岗位：法务管理</li><li>工作地点：TEST_ONLY地点</li></ul><div><h4 class="listTitle">岗位职责</h4></div><ol><li><div id="descDetail">TEST_ONLY职责</div></li></ol><div><h4 class="listTitle">岗位要求</h4></div><ul><li>学历要求：硕士研究生</li><li>专业要求：法学</li></ul><button onclick="grey5()">申请</button>`;

export function nationalBindingFixture() {
  const source = trustedFixture("national-binding-TEST_ONLY").source;
  const reference = { artifact_id: "fixture:source-reference", integrity_hash: canonicalHash("fixture:source-reference") };
  const evidence = (name: string, locator: string, html: string): SOVDiscoveryEvidence => {
    const bytes = new TextEncoder().encode(html);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const endpoint = { ...source.endpoint, adapter_key: adapterKey, locator };
    const snapshot = { ...source.snapshot, transport_status: "SUCCESS" as const,
      snapshot_id: `fixture:national:${name}` as never, raw_blob_id: `sha256:${hash}` as never,
      content_hash: hash as never, content_length: bytes.length,
      request_metadata: { ...source.snapshot.request_metadata, locator },
      response_metadata: { ...source.snapshot.response_metadata, mime_type: "text/html; charset=UTF-8", content_length: bytes.length } };
    const record = createExtractedRecordV2(snapshot, { ...source.extracted_record,
      extraction: { extractor_name: "TEST_ONLY", extractor_version: "1.0.0", schema_version: "fixture/1.0.0" } });
    return { scope: "SYNTHETIC_TEST", endpoint, snapshot, extracted_record: record,
      raw_blob: { raw_blob_id: snapshot.raw_blob_id, bytes, sha256: hash, byte_length: bytes.length, content_type: "text/html; charset=UTF-8" },
      acquisition: { acquisition_run_id: `fixture:${name}`, status: "SUCCESS", integrity_hash: canonicalHash(name), complete: true },
      source_reference: { source_definition: reference, endpoint: reference, admission: reference, allowlist: reference, authority_level: "OFFICIAL" } };
  };
  const campaign = evidence("campaign", campaignUrl, campaignHtml);
  const membership = evidence("membership", membershipUrl, memberHtml);
  let detail = evidence("detail", jobUrl, detailHtml);
  const claim = (id: string, namespace: string, locator: string) => ({ identity_state: "CONFIRMED" as const,
    official_identifier: text(id), identifier_namespace: namespace, evidence_locator: { kind: "SOURCE_RECORD" as const, locator } });
  const campaignClaim = claim(campaignId, "official:chnenergy:recruitment-campaign", `${campaign.snapshot.snapshot_id}#p.lead.text-center`);
  const jobClaim = claim(jobId, "official:chnenergy:campus-position", `${membership.snapshot.snapshot_id}#a[href]`);
  const dependency = (item: SOVDiscoveryEvidence) => ({ snapshot_id: item.snapshot.snapshot_id,
    extracted_record_id: item.extracted_record.extracted_record_id, raw_sha256: item.raw_blob.sha256 });
  detail = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, { ...detail.extracted_record,
    raw_source_record_id: `chnenergy:${jobId}:position`,
    identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: `chnenergy:${jobId}:position`, confidence: "HIGH" }],
    source_record_locator: { kind: "HTML", selector: "#descDetail", path: `chnenergy:${jobId}:position` },
    raw_title: text("法务管理"), raw_organization_name: text("TEST_ONLY单位"), raw_location_text: [text("TEST_ONLY地点")],
    raw_description: text("TEST_ONLY职责"), raw_requirement_text: text("学历要求：硕士研究生\n专业要求：法学"),
    recruitment_year: text("2027"), recruitment_batch: text("国家能源投资集团有限责任公司2027年度高校毕业生统招"),
    recruitment_context: { announcement: campaignClaim, recruitment_batch: { applicability: "APPLICABLE", identity: campaignClaim },
      position: jobClaim, opportunity: jobClaim }, announcement_url: jobUrl, application_url: jobUrl,
    adapter_metadata: { [adapterKey]: { binding_contract_version: "national-campaign-membership/1.0.0",
      campaign: dependency(campaign), membership: dependency(membership) } },
    extraction: { extractor_name: "Chnenergy2027ReviewedOfficialHtmlAdapter", extractor_version: "2.0.0",
      schema_version: `${adapterKey}-extracted-record/2.0.0` } }) };
  const evidenceList = [campaign, membership, detail];
  const executions: TrustedRestorationExecution<TrustedChainCommand>[] = [];
  const journal = {
    async list() { return executions.map(execution => structuredClone(execution.record)); },
    async appendExecution(execution: TrustedRestorationExecution<TrustedChainCommand>) {
      executions.push(structuredClone(execution)); return "APPENDED" as const;
    },
    async readArtifactEnvelope(kind: string, id: string, scope: string) {
      return structuredClone(executions.flatMap(execution => execution.artifact_envelopes)
        .find(envelope => envelope.artifact_kind === kind && envelope.artifact_id === id && envelope.scope === scope) ?? null);
    },
    async readVerifiedDiscovery(snapshotId: string, recordId: string) {
      const matches = evidenceList.filter(item => item.snapshot.snapshot_id === snapshotId && item.extracted_record.extracted_record_id === recordId);
      if (matches.length !== 1) throw new Error("EVIDENCE_BLOCKED: missing or ambiguous persisted evidence");
      return structuredClone(matches[0]!);
    }
  };
  const command = () => ({ kind: "SOURCE_OCCURRENCE_MATERIALIZE" as const,
    input: { source_role: "POSITION_BEARING" as const, endpoint: evidenceList[2]!.endpoint,
      snapshot: evidenceList[2]!.snapshot, extracted_record: evidenceList[2]!.extracted_record } });
  return { campaign, membership, detail, evidenceList, journal, executions, command };
}

test("National v2 cannot seal an occurrence without a persisted evidence reader", async () => {
  const fixture = nationalBindingFixture();
  const { readVerifiedDiscovery, ...journal } = fixture.journal;
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
  await assert.rejects(root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF }), /EVIDENCE_BLOCKED/);
  assert.equal(fixture.executions.length, 0);
});

function replaceHtml(fixture: Omit<ReturnType<typeof nationalBindingFixture>, "command">, index: number, html: string) {
  const item = fixture.evidenceList[index]!;
  const bytes = new TextEncoder().encode(html);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const snapshot = { ...item.snapshot, transport_status: "SUCCESS" as const,
    raw_blob_id: `sha256:${hash}` as never, content_hash: hash as never, content_length: bytes.length,
    response_metadata: { ...item.snapshot.response_metadata, content_length: bytes.length } };
  const record = createExtractedRecordV2(snapshot, item.extracted_record);
  fixture.evidenceList[index] = { ...item, snapshot, extracted_record: record,
    raw_blob: { ...item.raw_blob, bytes, raw_blob_id: snapshot.raw_blob_id, sha256: hash, byte_length: bytes.length } };
  if (index < 2) {
    const detail = fixture.evidenceList[2]!;
    const binding = detail.extracted_record.adapter_metadata[adapterKey]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, adapter_metadata: { [adapterKey]: { ...binding,
        [index === 0 ? "campaign" : "membership"]: { snapshot_id: snapshot.snapshot_id,
          extracted_record_id: record.extracted_record_id, raw_sha256: hash } } } }) };
  }
}

const rejectedCases: readonly [string, (fixture: ReturnType<typeof nationalBindingFixture>) => void][] = [
  ["missing dependency", fixture => { fixture.evidenceList.splice(0, 1); }],
  ["tampered Raw bytes", fixture => { fixture.evidenceList[0] = { ...fixture.campaign,
    raw_blob: { ...fixture.campaign.raw_blob, bytes: new TextEncoder().encode("tampered") } }; }],
  ["wrong campaign year", fixture => replaceHtml(fixture, 0, campaignHtml.replaceAll("2027", "2028"))],
  ["wrong campaign link", fixture => replaceHtml(fixture, 0, campaignHtml.replaceAll(campaignId, "wrong-campaign"))],
  ["wrong member form campaign", fixture => replaceHtml(fixture, 1, memberHtml.replaceAll(campaignId, "wrong-campaign"))],
  ["wrong member job", fixture => replaceHtml(fixture, 1, memberHtml.replaceAll(jobId, "wrong-job"))],
  ["ambiguous member", fixture => replaceHtml(fixture, 1, memberHtml + memberHtml)],
  ["ambiguous campaign", fixture => replaceHtml(fixture, 0, campaignHtml + campaignHtml)],
  ["wrong member title", fixture => replaceHtml(fixture, 1, memberHtml.replace("法务管理", "其他岗位"))],
  ["unsafe job link origin", fixture => replaceHtml(fixture, 1, memberHtml.replace('/annc/showgw', 'https://evil.invalid/annc/showgw'))],
  ["wrong source authority", fixture => { fixture.evidenceList[0] = { ...fixture.campaign,
    source_reference: { ...fixture.campaign.source_reference, authority_level: "UNTRUSTED" as never } }; }],
  ["wrong scope", fixture => { fixture.evidenceList[0] = { ...fixture.campaign, scope: "PRODUCTION" }; }],
  ["invented project identity", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, recruitment_context: { ...detail.extracted_record.recruitment_context!,
        recruitment_plan: { identity_state: "CONFIRMED", official_identifier: text("invented-project"),
          identifier_namespace: "official:chnenergy:recruitment-project", evidence_locator: { kind: "HTML", selector: "button" } } } }) }; }],
  ["forged business fields", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot,
      { ...detail.extracted_record, raw_requirement_text: text("无条件录用") }) }; }],
  ["forged batch claim", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot,
      { ...detail.extracted_record, recruitment_year: text("2028") }) }; }],
  ["caller verified flag", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, adapter_metadata: { [adapterKey]: { ...detail.extracted_record.adapter_metadata[adapterKey], verified: true } } }) }; }],
  ["unsupported extractor name", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, extraction: { ...detail.extracted_record.extraction, extractor_name: "UnreviewedParser" } }) }; }],
  ["future extractor contract", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, extraction: { ...detail.extracted_record.extraction, extractor_version: "3.0.0" } }) }; }],
  ["endpoint adapter downgrade", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, endpoint: { ...detail.endpoint, adapter_key: "unrelated-adapter" } }; }],
  ["v1 label carrying a v2 binding contract", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, extraction: { ...detail.extracted_record.extraction, extractor_version: "1.0.0" } }) }; }],
  ["forged occurrence key", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot,
      { ...detail.extracted_record, raw_source_record_id: "unrelated-job" }) }; }],
  ["forged identity candidate", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot,
      { ...detail.extracted_record, identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: "unrelated-job", confidence: "HIGH" }] }) }; }],
  ["forged record locator", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot,
      { ...detail.extracted_record, source_record_locator: { kind: "HTML", selector: "button[onclick]" } }) }; }],
  ["caller completeness promotion", fixture => { const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, adapter_metadata: { [adapterKey]: { ...detail.extracted_record.adapter_metadata[adapterKey], completeness: "COMPLETE" } } }) }; }]
];

for (const [name, mutate] of rejectedCases) {
  test(`National v2 rejects ${name} before sealing`, async () => {
    const fixture = nationalBindingFixture();
    const command = fixture.command();
    mutate(fixture);
    const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
    await assert.rejects(root.execute(fixture.evidenceList.length === 3 ? fixture.command() : command,
      { actor: "TEST_ONLY", recorded_at: AS_OF }), /National|Discovery|EVIDENCE_BLOCKED/u);
    assert.equal(fixture.executions.length, 0);
  });
}

test("National v2 seals exact retained binding without inventing a recruitment project", async () => {
  const fixture = nationalBindingFixture();
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  const result = await root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF }) as { source_role: string; version: { source_occurrence_version_id: string } };
  assert.equal(result.source_role, "POSITION_BEARING");
  assert.equal(fixture.executions.length, 1);
  assert.equal(fixture.executions[0]!.artifact_envelopes.length, 1);
  assert.equal(fixture.detail.extracted_record.recruitment_context?.recruitment_plan, undefined);
  const replay = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  assert.ok(replay.root.resolvers.source_occurrences.resolve(result.version.source_occurrence_version_id as never));
  fixture.evidenceList.splice(0, 1);
  await assert.rejects(bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal }));
});

test("National v2 rejects a caller record different from its persisted event", async () => {
  const fixture = nationalBindingFixture();
  const command = fixture.command();
  const forged = { ...command, input: { ...command.input, extracted_record: createExtractedRecordV2(command.input.snapshot,
    { ...command.input.extracted_record, raw_title: text("其他岗位") }) } };
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  await assert.rejects(root.execute(forged, { actor: "TEST_ONLY", recorded_at: AS_OF }));
  assert.equal(fixture.executions.length, 0);
});

test("National v1 rejects correct historical declarations without a retained reader", async () => {
  const fixture = nationalBindingFixture();
  const detail = fixture.evidenceList[2]!;
  const { readVerifiedDiscovery, ...journal } = fixture.journal;
  const { recruitment_context, ...legacy } = detail.extracted_record;
  const record = createExtractedRecordV2(detail.snapshot, { ...legacy, adapter_metadata: { [adapterKey]: {
    source_role: "PACKAGE", campaign_url: campaignUrl, membership_evidence_url: membershipUrl,
    official_project_id: "e929662a-324a-47d0-b4ca-9fe5ef47b8ba",
    binding_basis: "REVIEWED_OFFICIAL_CAMPAIGN_MEMBER_AND_EXACT_PROJECT_ID",
    application_link_basis: "PUBLIC_JOB_PAGE_HAS_APPLY_ENTRY_LOGIN_NOT_ACQUIRED" } },
    extraction: { ...detail.extracted_record.extraction, extractor_version: "1.0.0" } });
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
  await assert.rejects(root.execute({ ...fixture.command(), input: { ...fixture.command().input, source_role: "PACKAGE", extracted_record: record } },
    { actor: "TEST_ONLY", recorded_at: AS_OF }), /National/);
  assert.equal(fixture.executions.length, 0);
});

function historicalFixture() {
  const fixture = nationalBindingFixture();
  const job = CHNENERGY_JOBS[0]!;
  fixture.evidenceList[2] = { ...fixture.evidenceList[2]!, snapshot: { ...fixture.evidenceList[2]!.snapshot,
    recruitment_endpoint_id: chnenergyEndpoint(job).recruitment_endpoint_id }, endpoint: {
    ...chnenergyEndpoint(job), source_definition_id: fixture.detail.endpoint.source_definition_id } };
  replaceHtml(fixture, 2, detailHtml.replace("TEST_ONLY单位", job.employer)
    .replace("TEST_ONLY地点", job.location)
    .replace("grey5()", `apply('${jobId}','e929662a-324a-47d0-b4ca-9fe5ef47b8ba')`));
  const detail = fixture.evidenceList[2]!;
  const record = new Chnenergy2027HtmlAdapter().extract({ endpoint: detail.endpoint, snapshot: detail.snapshot,
    raw_blob: { raw_blob_id: detail.snapshot.raw_blob_id!, bytes: detail.raw_blob.bytes,
      raw_content_sha256: detail.raw_blob.sha256 as never, mime_type: detail.raw_blob.content_type,
      byte_length: detail.raw_blob.byte_length, created_at: detail.snapshot.observed_at } })[0]!;
  fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
    ...record, extraction: { ...record.extraction, schema_version: `${adapterKey}-extracted-record/2.0.0` } }) };
  const command = () => ({ ...fixture.command(), input: { ...fixture.command().input, source_role: "PACKAGE" as const } });
  return { ...fixture, command };
}

test("historical synthetic Raw and reader support issuance and replay unchanged", async () => {
  const fixture = historicalFixture();
  const before = canonicalHash(fixture.command().input.extracted_record);
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  await root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF });
  await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  assert.equal(canonicalHash(fixture.command().input.extracted_record), before);
});

test("historical synthetic proof is required again in a fresh replay process", async () => {
  const fixture = historicalFixture();
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  await root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF });
  const directory = mkdtempSync(path.join(os.tmpdir(), "national-v1-TEST_ONLY-"));
  try {
    const input = path.join(directory, "evidence.json");
    const save = () => writeFileSync(input, JSON.stringify({ executions: fixture.executions,
      evidence: fixture.evidenceList.map(item => ({ ...item, raw_blob: { ...item.raw_blob, bytes: Array.from(item.raw_blob.bytes) } })) }));
    const run = () => execFileSync(process.execPath, ["--import", "tsx",
      path.resolve("tests/normalization/national-campaign-binding-worker.ts"), input], { encoding: "utf8", windowsHide: true }).trim();
    save();
    assert.equal(run(), "REPLAY_VERIFIED");
    fixture.evidenceList.splice(2, 1);
    save();
    assert.equal(run(), "REPLAY_BLOCKED");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const mutation of ["scope", "receipt", "business claim", "wrong job button", "wrong project button", "three UUID button"] as const) {
  test(`historical retained proof rejects ${mutation}`, async () => {
    const fixture = historicalFixture();
    const detail = fixture.evidenceList[2]!;
    if (mutation === "scope") fixture.evidenceList[2] = { ...detail, scope: "PRODUCTION" };
    else if (mutation === "receipt") fixture.evidenceList[2] = { ...detail, acquisition: { ...detail.acquisition, complete: false } };
    else if (mutation === "business claim") fixture.evidenceList[2] = { ...detail,
      extracted_record: createExtractedRecordV2(detail.snapshot, { ...detail.extracted_record, raw_description: text("forged") }) };
    else {
      const raw = new TextDecoder().decode(detail.raw_blob.bytes);
      replaceHtml(fixture, 2, mutation === "wrong job button" ? raw.replace(jobId, campaignId)
        : mutation === "wrong project button" ? raw.replace("e929662a-324a-47d0-b4ca-9fe5ef47b8ba", campaignId)
        : raw.replace("')\">申请", `','${campaignId}')\">申请`));
    }
    const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
    await assert.rejects(root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF }));
    assert.equal(fixture.executions.length, 0);
  });
}

test("correct historical PACKAGE declarations cannot issue or replay without Raw project binding", async () => {
  const fixture = historicalFixture();
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  await root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF });
  const detail = fixture.evidenceList[2]!;
  replaceHtml(fixture, 2, new TextDecoder().decode(detail.raw_blob.bytes)
    .replace(`apply('${jobId}','e929662a-324a-47d0-b4ca-9fe5ef47b8ba')`, "grey5()"));
  const changed = fixture.evidenceList[2]!;
  const command = fixture.command();
  const fresh = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: {
    ...fixture.journal, async list() { return []; } } });
  await assert.rejects(fresh.root.execute(command, { actor: "TEST_ONLY", recorded_at: AS_OF }), /National/);
  fixture.evidenceList[2] = { ...changed, extracted_record: detail.extracted_record };
  await assert.rejects(bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal }));
  assert.equal(fixture.executions.length, 1);
});

const legacyRejectedCases: readonly [string, (record: ReturnType<typeof createExtractedRecordV2>) => ReturnType<typeof createExtractedRecordV2>][] = [
  ["unreviewed extractor plus v2-labelled schema", record => ({ ...record, extraction: { ...record.extraction,
    extractor_name: "UnreviewedParser", schema_version: "national-campaign-membership-extraction/2.0.0" } })],
  ["unreviewed extractor with historical schema", record => ({ ...record, extraction: { ...record.extraction, extractor_name: "UnreviewedParser" } })],
  ["unsupported schema with historical extractor", record => ({ ...record, extraction: { ...record.extraction, schema_version: "unreviewed-schema/2.0.0" } })],
  ["wrong campaign URL", record => ({ ...record, adapter_metadata: { [adapterKey]: {
    ...record.adapter_metadata[adapterKey], campaign_url: `${origin}/annc/showgg?id=wrong-campaign` } } })],
  ["extra campaign query", record => ({ ...record, adapter_metadata: { [adapterKey]: {
    ...record.adapter_metadata[adapterKey], campaign_url: campaignUrl + "&unapproved=1" } } })],
  ["wrong membership origin", record => ({ ...record, adapter_metadata: { [adapterKey]: {
    ...record.adapter_metadata[adapterKey], membership_evidence_url: membershipUrl.replace(origin, "https://evil.invalid") } } })],
  ["wrong membership campaign", record => ({ ...record, adapter_metadata: { [adapterKey]: {
    ...record.adapter_metadata[adapterKey], membership_evidence_url: membershipUrl.replace(campaignId, "wrong-campaign") } } })],
  ["wrong membership filter", record => ({ ...record, adapter_metadata: { [adapterKey]: {
    ...record.adapter_metadata[adapterKey], membership_evidence_url: membershipUrl.replace("%E6%B3%95%E5%8A%A1%E7%AE%A1%E7%90%86", "%E5%90%88%E8%A7%84") } } })],
  ["extra membership query", record => ({ ...record, adapter_metadata: { [adapterKey]: {
    ...record.adapter_metadata[adapterKey], membership_evidence_url: membershipUrl + "&unapproved=1" } } })]
];

for (const [name, mutate] of legacyRejectedCases) {
  test(`historical v1 exception rejects ${name}`, async () => {
    const fixture = nationalBindingFixture();
    const detail = fixture.evidenceList[2]!;
    const { recruitment_context, ...legacy } = detail.extracted_record;
    const record = createExtractedRecordV2(detail.snapshot, { ...legacy, adapter_metadata: { [adapterKey]: {
      source_role: "PACKAGE", campaign_url: campaignUrl, membership_evidence_url: membershipUrl,
      official_project_id: "e929662a-324a-47d0-b4ca-9fe5ef47b8ba",
      binding_basis: "REVIEWED_OFFICIAL_CAMPAIGN_MEMBER_AND_EXACT_PROJECT_ID",
      application_link_basis: "PUBLIC_JOB_PAGE_HAS_APPLY_ENTRY_LOGIN_NOT_ACQUIRED" } },
      extraction: { ...legacy.extraction, extractor_version: "1.0.0" } });
    const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
    const command = fixture.command();
    await assert.rejects(root.execute({ ...command, input: { ...command.input, source_role: "PACKAGE",
      extracted_record: createExtractedRecordV2(detail.snapshot, mutate(record)) } },
      { actor: "TEST_ONLY", recorded_at: AS_OF }), /National/u);
    assert.equal(fixture.executions.length, 0);
  });
}

for (const field of ["deadline", "publish_time"] as const) {
  test(`National v2 rejects unsupported nonempty ${field}`, async () => {
    const fixture = nationalBindingFixture();
    const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot,
      { ...detail.extracted_record, [field]: text("2027-07-31") }) };
    const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
    await assert.rejects(root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF }), /National/u);
    assert.equal(fixture.executions.length, 0);
  });
}

test("v1 label cannot bypass a stripped package binding declaration", async () => {
  const fixture = nationalBindingFixture();
  const detail = fixture.evidenceList[2]!;
  const { recruitment_context, ...stripped } = detail.extracted_record;
  const record = createExtractedRecordV2(detail.snapshot, { ...stripped, adapter_metadata: {},
    extraction: { ...stripped.extraction, extractor_version: "1.0.0" } });
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  const command = fixture.command();
  await assert.rejects(root.execute({ ...command, input: { ...command.input, source_role: "PACKAGE", extracted_record: record } },
    { actor: "TEST_ONLY", recorded_at: AS_OF }), /National/u);
  assert.equal(fixture.executions.length, 0);
});

for (const metadata of [{}, { binding_context: { verified: true } }]) {
  test(`v1 label cannot bypass retained campaign identity with ${Object.keys(metadata).length ? "binding_context" : "stripped metadata"}`, async () => {
    const fixture = nationalBindingFixture();
    const detail = fixture.evidenceList[2]!;
    fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, {
      ...detail.extracted_record, adapter_metadata: { [adapterKey]: metadata },
      extraction: { ...detail.extracted_record.extraction, extractor_version: "1.0.0" } }) };
    const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
    await assert.rejects(root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF }), /National/u);
    assert.equal(fixture.executions.length, 0);
  });
}

test("National gate rejects an inconsistent reader response even if references are present", async () => {
  const fixture = nationalBindingFixture();
  const journal = { ...fixture.journal, async readVerifiedDiscovery(snapshotId: string, recordId: string) {
    const item = await fixture.journal.readVerifiedDiscovery(snapshotId, recordId);
    return snapshotId === fixture.campaign.snapshot.snapshot_id
      ? { ...item, snapshot: { ...item.snapshot, snapshot_id: "forged-reader-event" as never } } : item;
  } };
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: journal });
  await assert.rejects(root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF }), /National reader/u);
  assert.equal(fixture.executions.length, 0);
});

test("fresh process reconstructs National proof and rejects orphaned replay dependencies", async () => {
  const fixture = nationalBindingFixture();
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  await root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF });
  const directory = mkdtempSync(path.join(os.tmpdir(), "national-binding-TEST_ONLY-"));
  try {
    const input = path.join(directory, "evidence.json");
    const worker = path.resolve("tests/normalization/national-campaign-binding-worker.ts");
    const save = () => writeFileSync(input, JSON.stringify({ executions: fixture.executions,
      evidence: fixture.evidenceList.map(item => ({ ...item, raw_blob: { ...item.raw_blob, bytes: Array.from(item.raw_blob.bytes) } })) }));
    save();
    const run = () => execFileSync(process.execPath, ["--import", "tsx", worker, input], { encoding: "utf8", windowsHide: true });
    assert.equal(run().trim(), "REPLAY_VERIFIED");
    fixture.evidenceList.splice(0, 1);
    save();
    assert.equal(run().trim(), "REPLAY_BLOCKED");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("National rediscovery verifies retained dependency closure before issuing support", async () => {
  const fixture = nationalBindingFixture();
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  const materialized = await root.execute(fixture.command(), { actor: "TEST_ONLY", recorded_at: AS_OF }) as {
    version: { source_occurrence_version_id: string }
  };
  const snapshot = { ...fixture.detail.snapshot, snapshot_id: "fixture:national:rediscovery" as never };
  const record = createExtractedRecordV2(snapshot, fixture.detail.extracted_record);
  fixture.evidenceList.push({ ...fixture.detail, snapshot, extracted_record: record });
  const command = { kind: "SOURCE_DISCOVERY_SUPPORT_VERIFY" as const, input: {
    schema_version: "trusted-sov-discovery-support/1.0.0" as const,
    sov_id: materialized.version.source_occurrence_version_id as never,
    snapshot_id: snapshot.snapshot_id, extracted_record_id: record.extracted_record_id, source_role: "POSITION_BEARING" as const } };
  await root.execute(command, { actor: "TEST_ONLY", recorded_at: AS_OF });
  assert.equal(fixture.executions.length, 2);
  fixture.evidenceList.splice(0, 1);
  await assert.rejects(root.execute(command, { actor: "TEST_ONLY", recorded_at: AS_OF }));
  assert.equal(fixture.executions.length, 2);
});

test("National detail package retains campaign Raw references without manufacturing project or requirement claims", async () => {
  const fixture = nationalBindingFixture();
  const detail = fixture.evidenceList[2]!;
  const { recruitment_context, raw_requirement_text, ...position } = detail.extracted_record;
  const recordKey = `chnenergy:${jobId}:package`;
  fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, { ...position,
    raw_source_record_id: recordKey,
    identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: recordKey, confidence: "HIGH" }],
    source_record_locator: { kind: "HTML", selector: "h4.listTitle", path: recordKey },
    raw_description: text("TEST_ONLY单位 法务管理"), raw_location_text: [] }) };
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  const command = fixture.command();
  const result = await root.execute({ ...command, input: { ...command.input, source_role: "PACKAGE" } },
    { actor: "TEST_ONLY", recorded_at: AS_OF }) as { extracted_record: typeof position };
  assert.equal(result.extracted_record.adapter_metadata[adapterKey]!.campaign !== undefined, true);
  assert.ok(new TextDecoder().decode(fixture.campaign.raw_blob.bytes).includes("毕业生年龄计算的截止时间为2027年7月31日。"));
  assert.equal(fixture.executions.length, 1);
  assert.equal(fixture.evidenceList[2]!.extracted_record.recruitment_context, undefined);
  assert.equal(fixture.evidenceList[2]!.extracted_record.raw_requirement_text, undefined);
});
