import * as cheerio from "cheerio";
import { Chnenergy2027HtmlAdapter } from "../../production-sources/chnenergy-2027-source";
import type { TrustedSourceOccurrenceMaterializationInput } from "../normalization/trusted-source-occurrence-registry";
import { canonicalSerialize } from "../normalization/canonical-artifact-registry";
import { createExtractedRecordV2 } from "../normalization/extracted-record-identity";
import type { ExtractedRecord } from "../domain";
import { SOVDiscoverySupportError, validateDiscoveryEvidence,
  type DiscoverySupportScope, type SOVDiscoveryEvidence } from "../normalization/source-discovery-support";

const adapterKey = "cn-chnenergy-2027-reviewed-official-html";
const bindingVersion = "national-campaign-membership/1.0.0";
const origin = "https://zhaopin.chnenergy.com.cn";
type DiscoveryReader = (snapshotId: string, recordId: string) => Promise<SOVDiscoveryEvidence>;
interface Dependency {
  readonly snapshot_id: string;
  readonly extracted_record_id: string;
  readonly raw_sha256: string;
}

interface NationalCampaignPreparationInput extends Omit<TrustedSourceOccurrenceMaterializationInput, "extracted_record"> {
  readonly extracted_record: ExtractedRecord;
}

export async function prepareNationalCampaignRecord(
  input: NationalCampaignPreparationInput,
  scope: DiscoverySupportScope,
  readDiscovery: DiscoveryReader | undefined
): Promise<ExtractedRecord> {
  const record = input.extracted_record;
  const schema = "schema_version" in record.extraction ? record.extraction.schema_version : undefined;
  requireBinding(input.endpoint.adapter_key === adapterKey
    && record.extraction.extractor_name === "Chnenergy2027ReviewedOfficialHtmlAdapter"
    && record.extraction.extractor_version === "2.0.0"
    && (schema === undefined || schema === `${adapterKey}-extracted-record/2.0.0`)
    && record.source_definition_id === input.endpoint.source_definition_id
    && record.snapshot_id === input.snapshot.snapshot_id
    && input.snapshot.recruitment_endpoint_id === input.endpoint.recruitment_endpoint_id
    && input.snapshot.transport_status === "SUCCESS"
    && (input.source_role === "PACKAGE" || input.source_role === "POSITION_BEARING"),
    "National preparation requires an ordinary v2 detail record");
  requireBinding(!("contract_version" in record) && record.recruitment_year === undefined
    && record.recruitment_batch === undefined && record.recruitment_context === undefined,
    "National preparation cannot overwrite existing campaign or historical claims");
  requireBinding(!record.deadline?.text.trim() && !record.publish_time?.text.trim(),
    "National date claims have no supported retained Raw binding");
  requireBinding(!!readDiscovery, "National retained discovery reader is required");
  const proof = await readNationalCampaignProof(input, scope, readDiscovery);
  const recordKey = `chnenergy:${proof.jobId}:${input.source_role === "PACKAGE" ? "package" : "position"}`;
  requireBinding(record.raw_source_record_id === recordKey, "National occurrence key differs from exact job");
  same(record.identity_candidates, [{ kind: "SOURCE_RECORD_ID", value: recordKey, confidence: "HIGH" }],
    "National identity candidates differ from exact job");
  same(record.source_record_locator, { kind: "HTML", selector: input.source_role === "PACKAGE" ? "h4.listTitle" : "#descDetail", path: recordKey },
    "National record locator differs from exact detail surface");
  requireBinding(record.announcement_url === input.endpoint.locator && record.application_url === input.endpoint.locator,
    "National public job URL claim mismatch");
  return { ...structuredClone(record), recruitment_year: proof.year, recruitment_batch: proof.batch,
    ...(input.source_role === "POSITION_BEARING" ? { recruitment_context: proof.context } : {}) };
}

export async function verifyNationalCampaignBinding(
  input: TrustedSourceOccurrenceMaterializationInput,
  scope: DiscoverySupportScope,
  readDiscovery: DiscoveryReader | undefined
): Promise<void> {
  const extraction = input.extracted_record.extraction;
  const metadata = input.extracted_record.adapter_metadata[adapterKey];
  if (input.endpoint.adapter_key !== adapterKey && !metadata
    && extraction.extractor_name !== "Chnenergy2027ReviewedOfficialHtmlAdapter") return;
  const recruitment = input.extracted_record.recruitment_context;
  const retainedIdentity = [recruitment?.announcement, recruitment?.recruitment_batch?.identity]
    .some(claim => claim?.identity_state === "CONFIRMED" && claim.identifier_namespace === "official:chnenergy:recruitment-campaign");
  if (extraction.extractor_version === "1.0.0" && !metadata?.binding_contract_version
    && !metadata?.binding_context && !metadata?.campaign && !metadata?.membership && !retainedIdentity) {
    const historicalCampaignUrl = `${origin}/annc/showgg?id=6a152f40-7fe5-460e-ad37-0024acafd8c9`;
    const historicalTarget = [
      ["5a798bfe-a4d6-0be4-e063-98b4d40a088a", "法务管理"],
      ["5a798bfe-ac8c-0be4-e063-98b4d40a088a", "合规管理岗"]
    ].find(([jobId]) => input.endpoint.locator === `${origin}/annc/showgw?id=${jobId}`);
    requireBinding(input.endpoint.adapter_key === adapterKey && !!metadata
      && extraction.extractor_name === "Chnenergy2027ReviewedOfficialHtmlAdapter"
      && extraction.schema_version === `${adapterKey}-extracted-record/2.0.0`
      && !!historicalTarget && input.extracted_record.raw_title?.text === historicalTarget[1]
      && metadata.campaign_url === historicalCampaignUrl
      && metadata.membership_evidence_url === `${origin}/annc/showggStationList?id=6a152f40-7fe5-460e-ad37-0024acafd8c9&zhaopingangwei=${encodeURIComponent(historicalTarget[1]!)}`
      && Object.keys(metadata).sort().join(",") === "application_link_basis,binding_basis,campaign_url,membership_evidence_url,official_project_id,source_role"
      && metadata.source_role === input.source_role
      && metadata.official_project_id === "e929662a-324a-47d0-b4ca-9fe5ef47b8ba"
      && metadata.binding_basis === "REVIEWED_OFFICIAL_CAMPAIGN_MEMBER_AND_EXACT_PROJECT_ID"
      && metadata.application_link_basis === "PUBLIC_JOB_PAGE_HAS_APPLY_ENTRY_LOGIN_NOT_ACQUIRED",
    "National historical v1 binding declaration is missing or unsupported");
    requireBinding(!!readDiscovery, "National historical retained discovery reader is required");
    const detail = await readDiscovery(input.snapshot.snapshot_id, input.extracted_record.extracted_record_id);
    validateDiscoveryEvidence(detail, scope);
    same(detail.endpoint, input.endpoint, "National historical endpoint differs from persisted evidence");
    same(detail.snapshot, input.snapshot, "National historical Snapshot differs from persisted evidence");
    same(detail.extracted_record, input.extracted_record, "National historical record differs from persisted evidence");
    endpointId(detail, "/annc/showgw", ["id"]);
    html(detail);
    let records;
    try {
      records = new Chnenergy2027HtmlAdapter().extract({ endpoint: detail.endpoint, snapshot: detail.snapshot,
        raw_blob: { raw_blob_id: detail.snapshot.raw_blob_id!, bytes: detail.raw_blob.bytes,
          raw_content_sha256: detail.raw_blob.sha256 as never, mime_type: detail.raw_blob.content_type,
          byte_length: detail.raw_blob.byte_length, created_at: detail.snapshot.observed_at } });
    } catch {
      throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "National historical Raw fails original adapter binding");
    }
    const expected = records.find(record => record.adapter_metadata[adapterKey]?.source_role === input.source_role);
    requireBinding(!!expected, "National historical source role is unsupported");
    same(input.extracted_record, createExtractedRecordV2(detail.snapshot, { ...expected,
      extraction: { ...expected.extraction, schema_version: `${adapterKey}-extracted-record/2.0.0` } }),
    "National historical canonical record differs from original Raw extraction");
    return;
  }
  requireBinding(input.endpoint.adapter_key === adapterKey && extraction.extractor_name === "Chnenergy2027ReviewedOfficialHtmlAdapter"
    && extraction.extractor_version === "2.0.0"
    && input.extracted_record.extraction.schema_version === `${adapterKey}-extracted-record/2.0.0`, "Unsupported National extraction contract");
  if (!readDiscovery) throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "EVIDENCE_BLOCKED: National retained discovery reader is required");
  const detail = await readDiscovery(input.snapshot.snapshot_id, input.extracted_record.extracted_record_id);
  validateDiscoveryEvidence(detail, scope);
  same(detail.endpoint, input.endpoint, "National endpoint differs from persisted evidence");
  same(detail.snapshot, input.snapshot, "National Snapshot differs from persisted evidence");
  same(detail.extracted_record, input.extracted_record, "National record differs from persisted evidence");
  const proof = await readNationalCampaignProof(input, scope, readDiscovery);
  const { campaign, membership, jobId } = proof;
  for (const evidence of [campaign, membership]) {
    same(evidence.source_reference.source_definition, detail.source_reference.source_definition, "National source definition proof mismatch");
  }
  const detailDom = html(detail);
  const sections = (label: string) => {
    const headers = detailDom("h4.listTitle").filter((_index, node) => clean(detailDom(node).text()) === label);
    requireBinding(headers.length === 1, "National detail section is missing or ambiguous");
    const content = headers.parent().next();
    requireBinding(content.is("ul,ol"), "National detail section boundary changed");
    return content;
  };
  const info = sections("岗位基本信息");
  const field = (label: string) => {
    const matches = info.find("li,div.col-md-5").filter((_index, node) => detailDom(node).children().length === 0
      && clean(detailDom(node).text()).startsWith(`${label}：`));
    requireBinding(matches.length === 1, "National detail field is missing or ambiguous");
    const value = clean(matches.text()).slice(label.length + 1);
    requireBinding(value.length > 0, "National detail field is empty");
    return value;
  };
  const employer = field("招聘单位");
  const title = field("招聘岗位");
  const location = field("工作地点");
  requireBinding(clean(detailDom("title").text()) === "岗位详情"
    && proof.jobTitle === title,
  "National job title/filter binding mismatch");
  const description = sections("岗位职责").find("#descDetail");
  requireBinding(description.length === 1, "National duty surface is missing or ambiguous");
  const requirements = sections("岗位要求").find("li").map((_index, node) => clean(detailDom(node).text())).get();
  requireBinding(requirements.some(value => value.startsWith("学历要求：")) && requirements.some(value => value.startsWith("专业要求：")),
    "National requirement surface is missing");
  const record = input.extracted_record;
  requireBinding(!record.deadline?.text.trim() && !record.publish_time?.text.trim(),
    "National date claims have no supported retained Raw binding");
  const recordKey = `chnenergy:${jobId}:${input.source_role === "PACKAGE" ? "package" : "position"}`;
  requireBinding(record.raw_source_record_id === recordKey, "National occurrence key differs from exact job");
  same(record.identity_candidates, [{ kind: "SOURCE_RECORD_ID", value: recordKey, confidence: "HIGH" }],
    "National identity candidates differ from exact job");
  same(record.source_record_locator, { kind: "HTML", selector: input.source_role === "PACKAGE" ? "h4.listTitle" : "#descDetail", path: recordKey },
    "National record locator differs from exact detail surface");
  same(record.raw_title, original(title), "National title claim differs from Raw");
  same(record.raw_organization_name, original(employer), "National employer claim differs from Raw");
  same(record.recruitment_year, proof.year, "National year claim differs from campaign");
  same(record.recruitment_batch, proof.batch, "National batch claim differs from campaign");
  requireBinding(record.announcement_url === detail.snapshot.request_metadata.locator
    && record.application_url === detail.snapshot.request_metadata.locator, "National public job URL claim mismatch");
  if (input.source_role === "PACKAGE") {
    requireBinding(record.recruitment_context === undefined && record.raw_requirement_text === undefined,
      "National detail package cannot invent position or requirement claims");
    same(record.raw_location_text, [], "National detail package location mismatch");
    same(record.raw_description, original(`${employer} ${title}`), "National detail package description mismatch");
    return;
  }
  same(record.raw_location_text, [original(location)], "National location claim differs from Raw");
  same(record.raw_description, original(description.text().trim()), "National duty claim differs from Raw");
  same(record.raw_requirement_text, original(requirements.join("\n")), "National requirements claim differs from Raw");
  const context = record.recruitment_context;
  requireBinding(!!context && context.recruitment_plan === undefined, "National project identity is unproven");
  same(context, proof.context, "National recruitment identity claims differ from retained chain");
}

async function readNationalCampaignProof(
  input: NationalCampaignPreparationInput,
  scope: DiscoverySupportScope,
  readDiscovery: DiscoveryReader
) {
  const binding = input.extracted_record.adapter_metadata[adapterKey];
  requireBinding(!!binding && typeof binding === "object" && !Array.isArray(binding), "National retained binding references are missing");
  requireBinding(Object.keys(binding).sort().join(",") === "binding_contract_version,campaign,membership"
    && binding.binding_contract_version === bindingVersion, "National binding contract or claims are unsupported");
  const campaignRef = dependency(binding.campaign);
  const memberRef = dependency(binding.membership);
  requireBinding(new Set([campaignRef.snapshot_id, memberRef.snapshot_id, input.snapshot.snapshot_id]).size === 3,
    "National binding requires three distinct captured surfaces");
  const campaign = await readDependency(campaignRef, readDiscovery, scope);
  const membership = await readDependency(memberRef, readDiscovery, scope);
  for (const evidence of [campaign, membership]) {
    requireBinding(evidence.endpoint.source_definition_id === input.endpoint.source_definition_id
      && evidence.extracted_record.source_definition_id === input.extracted_record.source_definition_id,
    "National binding source identity mismatch");
  }
  const campaignId = endpointId(campaign, "/annc/showgg", ["id"]);
  const jobId = endpointId(input, "/annc/showgw", ["id"]);
  const memberId = endpointId(membership, "/annc/showggStationList", ["id", "zhaopingangwei"]);
  requireBinding(campaignId === memberId, "National membership campaign mismatch");
  const campaignDom = html(campaign);
  const memberDom = html(membership);
  const titles = campaignDom("p.lead.text-center");
  requireBinding(titles.length === 1 && clean(titles.text()) === "国家能源投资集团有限责任公司2027年度高校毕业生统招公告",
    "National explicit 2027 campaign heading is missing or ambiguous");
  const campaignLinks = campaignDom("a[href]").toArray().filter(node =>
    resolvedUrl(campaignDom(node).attr("href"), campaign.snapshot.request_metadata.locator)
      === `${origin}/annc/showggStationList?id=${campaignId}`);
  requireBinding(campaignLinks.length === 1, "National campaign membership link is missing or ambiguous");
  const forms = memberDom("form#annclistform");
  requireBinding(forms.length === 1 && resolvedUrl(forms.attr("action"), membership.snapshot.request_metadata.locator)
    === `${origin}/annc/showggStationList`, "National member form boundary mismatch");
  const campaignInputs = forms.find('input[type="hidden"][name="id"]');
  requireBinding(campaignInputs.length === 1 && campaignInputs.attr("value") === campaignId,
    "National member form campaign mismatch");
  const jobLinks = memberDom("a[href]").toArray().filter(node =>
    resolvedUrl(memberDom(node).attr("href"), membership.snapshot.request_metadata.locator) === input.snapshot.request_metadata.locator);
  requireBinding(jobLinks.length === 1 && memberDom(jobLinks[0]).closest("li.list-group-item").length === 1,
    "National exact job membership is missing or ambiguous");
  same(campaign.source_reference.source_definition, membership.source_reference.source_definition,
    "National source definition proof mismatch");
  const jobTitle = clean(memberDom(jobLinks[0]).text());
  requireBinding(jobTitle === input.extracted_record.raw_title?.text
    && new URL(membership.snapshot.request_metadata.locator).searchParams.get("zhaopingangwei") === jobTitle,
    "National job title/filter binding mismatch");
  const heading = clean(titles.text());
  const year = heading.match(/(2027)年度/u)![1]!;
  const campaignClaim = { identity_state: "CONFIRMED" as const, official_identifier: original(campaignId),
    identifier_namespace: "official:chnenergy:recruitment-campaign",
    evidence_locator: { kind: "SOURCE_RECORD" as const, locator: `${campaign.snapshot.snapshot_id}#p.lead.text-center` } };
  const jobClaim = { identity_state: "CONFIRMED" as const, official_identifier: original(jobId),
    identifier_namespace: "official:chnenergy:campus-position",
    evidence_locator: { kind: "SOURCE_RECORD" as const, locator: `${membership.snapshot.snapshot_id}#a[href]` } };
  return { campaign, membership, jobId, jobTitle, year: original(year), batch: original(heading.replace(/公告$/u, "")),
    context: { announcement: campaignClaim, recruitment_batch: { applicability: "APPLICABLE" as const, identity: campaignClaim },
      position: jobClaim, opportunity: jobClaim } };
}

function dependency(value: unknown): Dependency {
  requireBinding(!!value && typeof value === "object" && !Array.isArray(value), "National dependency reference is missing");
  const reference = value as Record<string, unknown>;
  requireBinding(Object.keys(reference).sort().join(",") === "extracted_record_id,raw_sha256,snapshot_id"
    && typeof reference.snapshot_id === "string" && reference.snapshot_id.trim().length > 0
    && typeof reference.extracted_record_id === "string" && reference.extracted_record_id.trim().length > 0
    && typeof reference.raw_sha256 === "string" && /^[a-f0-9]{64}$/u.test(reference.raw_sha256), "National dependency reference is invalid");
  return reference as unknown as Dependency;
}

async function readDependency(reference: Dependency, readDiscovery: DiscoveryReader, scope: DiscoverySupportScope) {
  const evidence = await readDiscovery(reference.snapshot_id, reference.extracted_record_id);
  requireBinding(evidence.snapshot.snapshot_id === reference.snapshot_id
    && evidence.extracted_record.extracted_record_id === reference.extracted_record_id
    && evidence.raw_blob.sha256 === reference.raw_sha256, "National reader returned a different dependency");
  validateDiscoveryEvidence(evidence, scope);
  return evidence;
}

function endpointId(evidence: Pick<SOVDiscoveryEvidence, "endpoint" | "snapshot">, path: string, parameters: string[]) {
  requireBinding(evidence.endpoint.locator === evidence.snapshot.request_metadata.locator
    && evidence.snapshot.request_metadata.method === "GET", "National capture request binding mismatch");
  const url = new URL(evidence.snapshot.request_metadata.locator);
  requireBinding(url.origin === origin && url.pathname === path && url.hash === "" && url.username === "" && url.password === ""
    && [...url.searchParams.keys()].sort().join(",") === parameters.sort().join(","), "National exact capture URL mismatch");
  const id = url.searchParams.get("id");
  requireBinding(!!id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id), "National official identifier is invalid");
  return id;
}

function html(evidence: SOVDiscoveryEvidence) {
  requireBinding(/^text\/html(?:;|$)/iu.test(evidence.raw_blob.content_type), "National capture is not HTML");
  try { return cheerio.load(new TextDecoder("utf-8", { fatal: true }).decode(evidence.raw_blob.bytes)); }
  catch { throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", "National capture encoding is invalid"); }
}

function resolvedUrl(value: string | undefined, base: string) {
  if (!value) return null;
  try { return new URL(value, base).href; } catch { return null; }
}

function clean(value: string) { return value.replace(/\s+/gu, " ").trim(); }
function original(value: string) { return { text: value, encoding: "UTF-8" as const }; }
function same(actual: unknown, expected: unknown, message: string) {
  requireBinding(canonicalSerialize(actual ?? null) === canonicalSerialize(expected ?? null), message);
}
function requireBinding(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SOVDiscoverySupportError("EVIDENCE_BLOCKED", message);
}
