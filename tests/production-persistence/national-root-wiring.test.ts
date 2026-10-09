import "../helpers/network-guard";
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import childProcess from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { CollectionRunner } from "../../lib/collection-runtime/collection-runner";
import { RawCaptureService, InMemoryRawBlobRepository, InMemorySnapshotRepository, createExtractedRecordV2 } from "../../lib/ingestion";
import { ProductionRawObjectBoundary } from "../../lib/production-persistence/raw-object-boundary";
import { createHash } from "node:crypto";
import { ChnenergySupportingEvidenceAdapter, chnenergySupportingEndpoint, CHNENERGY_SUPPORT_ADAPTER_KEY } from "../../lib/production-sources/chnenergy-supporting-evidence";
import { CHNENERGY_CAMPAIGN_URL, CHNENERGY_JOBS, chnenergyEndpoint, Chnenergy2027CampaignHtmlAdapter, Chnenergy2027HtmlAdapter } from "../../lib/production-sources/chnenergy-2027-source";
import { GitRawObjectPersistence } from "../../lib/production-persistence/git-raw-object-persistence";
import { isExtractedRecordV2 } from "../../lib/ingestion/normalization/extracted-record-identity";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import type { HttpTransportRequest } from "../../lib/collection-runtime/types";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { canonicalSerialize, canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { sealQueryAuthorizationContract } from "../../lib/application/source-admission/query-authorization";
import { fixture as continuousFixture, AT, LATER, provenance, identity } from "./continuous-acquisition-fixture";

function fixture(exactUrl=CHNENERGY_CAMPAIGN_URL,detail=false) {
  const original = continuousFixture();

  const query = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0",
    base_exact_url: exactUrl.split("?")[0]!, parameters: [{ name: "id", required: true, allowed_values: [new URL(exactUrl).searchParams.get("id")!] }],
    approved_combinations: [[{ name: "id", value: new URL(exactUrl).searchParams.get("id")! }]], pagination: null, maximum_pages: 1, request_budget: 1,
    canonicalization: "QUERY_ASCII_RFC3986_V1" });
  const { continuous_acquisition_scope, ...base } = original.admitted;
  const chosenEndpoint=detail?chnenergyEndpoint(CHNENERGY_JOBS[0]!):chnenergySupportingEndpoint(exactUrl);
  const admissionId=`TEST_ONLY:admission:${chosenEndpoint.recruitment_endpoint_id}`;
  const admission = { ...base,source_admission_id:admissionId as typeof base.source_admission_id, recruitment_endpoint_id: chosenEndpoint.recruitment_endpoint_id, endpoint: exactUrl, automation_basis: "HUMAN_REVIEWED_CANARY" as const,
    evidence: base.evidence.map(item => ({ ...item,source_admission_id:admissionId as typeof item.source_admission_id, endpoint: exactUrl, source_url: exactUrl })) };
  const endpoint = { ...chosenEndpoint, locator: exactUrl,
    collection_config: { ...original.endpoint.collection_config, max_items: 1, max_pages: 1, retry_limit: 0, follow_redirects: false } };
  const versions: SourcePersistenceVersion[] = [];
  for (const source of original.versions) {
    let artifact = source.artifact;
    if (artifact.kind === "SOURCE_DEFINITION") artifact = { kind: artifact.kind, payload: {...artifact.payload, source_definition_id:endpoint.source_definition_id} };
    if (artifact.kind === "ADAPTER_REGISTRATION") artifact = { kind: artifact.kind, payload: {...artifact.payload,adapter_key:endpoint.adapter_key} };
    if (artifact.kind === "RECRUITMENT_ENDPOINT") artifact = { kind: artifact.kind, payload: endpoint };
    if (artifact.kind === "SOURCE_ADMISSION") artifact = { kind: artifact.kind, payload: admission };
    if (artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST") artifact = { kind: artifact.kind, payload: { ...artifact.payload,
      recruitment_endpoint_artifact_id: versions.find(item => item.artifact.kind === "RECRUITMENT_ENDPOINT")!.artifact_id,
      source_admission_artifact_id: versions.find(item => item.artifact.kind === "SOURCE_ADMISSION")!.artifact_id,
      host:new URL(exactUrl).hostname,path_prefix:new URL(exactUrl).pathname,
      query_policy: { mode: "ALLOW_LIST", allowed_parameters: ["id","zhaopingangwei"] }, allowlist_entry_id:`TEST_ONLY:allowlist:${endpoint.recruitment_endpoint_id}` } };
    versions.push(createSourcePersistenceVersion({ stream_id: artifact.kind === "SOURCE_DEFINITION" ? endpoint.source_definition_id : artifact.kind === "ADAPTER_REGISTRATION" ? endpoint.adapter_key : artifact.kind === "RECRUITMENT_ENDPOINT" ? endpoint.recruitment_endpoint_id : artifact.kind === "SOURCE_ADMISSION" ? admission.source_admission_id : artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST" ? artifact.payload.allowlist_entry_id : source.stream_id, revision: 1, supersedes_artifact_id: null,
      artifact, provenance, effective_at: AT, created_at: AT }));
  }
  const id = (kind: string) => versions.find(item => item.artifact.kind === kind)!.artifact_id;
  const claim = { schema_version: "supporting-inspection-execution/1.0.0", state: "CLAIMED",
    authorization: { authorization_mode: "AUTOMATION_CANARY", authorization_id: "TEST_ONLY:inspection-auth",
      source_admission_id: admission.source_admission_id, endpoint: exactUrl, recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      endpoint_purpose: admission.endpoint_purpose, allowed_http_method: "GET", collection_run_id: "TEST_ONLY:inspection-run",
      reviewer: "TEST_ONLY", issued_at: AT, evidence_id: admission.evidence[2]!.source_admission_evidence_id,
      scope: "ONE_ENDPOINT_ONE_RUN", manual_confirmation: true },
    bindings: { source_artifact_id: id("SOURCE_DEFINITION"), endpoint_artifact_id: id("RECRUITMENT_ENDPOINT"),
      admission_artifact_id: id("SOURCE_ADMISSION"), allowlist_artifact_id: id("OFFICIAL_ENDPOINT_ALLOWLIST"),
      adapter_artifact_id: id("ADAPTER_REGISTRATION") }, exact_url: exactUrl, method: "GET", query_contract_hash: query.contract_hash, claimed_at: LATER };
  return { versions, claim };
}


const job=CHNENERGY_JOBS[0]!;
const campaignId="6a152f40-7fe5-460e-ad37-0024acafd8c9";
const campaignHtml=`<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p><div id="anncTxt"><p>TEST_ONLY 年龄一般条件</p><a href="/annc/showggStationList?id=${campaignId}">岗位</a></div>`;
const memberHtml=`<form id="annclistform" action="/annc/showggStationList"><input type="hidden" name="id" value="${campaignId}"></form><ul><li class="list-group-item"><a href="${job.url}">${job.title}</a><p class="list-group-item-text"><span title="${job.employer}">单位</span></p></li></ul>`;
const detailHtml=`<title>岗位详情</title><button onclick="grey5()">申请</button><div><h4 class="listTitle">岗位基本信息</h4></div><ul><li>招聘单位：${job.employer}</li><li>招聘岗位：${job.title}</li><li>工作地点：${job.location}</li></ul><div><h4 class="listTitle">岗位职责</h4></div><ol><li><div id="descDetail">TEST_ONLY职责</div></li></ol><div><h4 class="listTitle">岗位要求</h4></div><ul><li>学历要求：硕士研究生</li><li>专业要求：法学</li></ul>`;
const now="2026-10-09T00:00:00.000Z";
function response(html:string,at=now){
  const bytes=new TextEncoder().encode(html);
  return {status:"SUCCESS" as const,responded_at:at as HttpTransportRequest["requested_at"],bytes,
    content_sha256:createHash("sha256").update(bytes).digest("hex") as never,http_status:200,headers:{"content-type":"text/html"},mime_type:"text/html"};
}
async function setup(forgedSupportRole=false){
  const directory=mkdtempSync(path.join(os.tmpdir(),"national-root-TEST_ONLY-"));
  const seed=path.join(directory,"seed"),remote=path.join(directory,"remote.git");
  const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]}).trim();
  mkdirSync(seed);git(directory,"init","--bare","--quiet",remote);git(seed,"init","--quiet","-b","main");
  writeFileSync(path.join(seed,"README.md"),"TEST_ONLY");
  const commit=()=>{git(seed,"add","--",".");git(seed,"-c",`user.name=${identity.name}`,"-c",`user.email=${identity.email}`,"commit","-qm","TEST_ONLY retained fixtures");};
  commit();git(seed,"remote","add","origin",remote);
  const parts=[fixture(),fixture(job.membership_url),fixture(job.url,true)];
  const versions=[...new Map(parts.flatMap(part=>part.versions).map(item=>[item.artifact_id,item])).values()];
  const source=new GitSourceRegistryPersistence({repository_path:seed});
  for(const version of versions)await source.appendVersion(version);
  commit();
  const raw=new GitRawObjectPersistence({repository_path:seed});
  const refs=[];
  for(const [index,html] of [campaignHtml,memberHtml].entries()){
    const part=parts[index]!;
    const endpointVersion=part.versions.find(item=>item.artifact.kind==="RECRUITMENT_ENDPOINT")!;
    if(endpointVersion.artifact.kind!=="RECRUITMENT_ENDPOINT")throw new Error("fixture");
    const endpoint=endpointVersion.artifact.payload;
    const adapter=new ChnenergySupportingEvidenceAdapter();
    const collection=await new CollectionRunner({transport:{async execute(){return response(html,LATER);}},
      raw_capture:new RawCaptureService(new InMemoryRawBlobRepository(),new InMemorySnapshotRepository()),
      policy:{timeout_ms:1000,retry_limit:0,retry_backoff_ms:0,rate_limit_ms:0,max_pages:1,request_budget:1},
      clock:{now:()=>LATER as HttpTransportRequest["requested_at"],now_ms:()=>Date.parse(LATER),sleep:async()=>{}}}).run({collection_run_id:`TEST_ONLY:support:${index}`,endpoint,adapter});
    const result=collection.request_results[0]!;
    assert.equal(collection.status,"SUCCESS");
    const records=collection.extracted_records.map(record=>createExtractedRecordV2(result.snapshot,{...record,
      ...(forgedSupportRole&&index===0?{adapter_metadata:{[CHNENERGY_SUPPORT_ADAPTER_KEY]:{...record.adapter_metadata[CHNENERGY_SUPPORT_ADAPTER_KEY],source_role:"POSITION_BEARING"}}}:{}),
      extraction:{...record.extraction,schema_version:CHNENERGY_SUPPORT_ADAPTER_KEY+"-extracted-record/2.0.0"}}));
    const id=(kind:string)=>part.versions.find(item=>item.artifact.kind===kind)!.artifact_id;
    await new ProductionRawObjectBoundary(raw,raw).persistSuccessfulAcquisition({raw_blob:result.raw_blob!,source_definition_id:endpoint.source_definition_id,
      recruitment_endpoint_id:endpoint.recruitment_endpoint_id,acquired_at:LATER,provenance,bundle:{
        acquisition_run:{acquisition_run_id:`TEST_ONLY:support:${index}:acquisition:1`,source_admission_artifact_id:id("SOURCE_ADMISSION"),
          endpoint_artifact_id:id("RECRUITMENT_ENDPOINT"),allowlist_artifact_id:id("OFFICIAL_ENDPOINT_ALLOWLIST"),status:"SUCCESS",
          started_at:LATER,completed_at:LATER,request_metadata:{locator:endpoint.locator,method:"GET",parameters:{}},
          result_metadata:{transport_status:"SUCCESS",extraction_status:"COMPLETE",extracted_record_count:records.length},provenance},
        snapshot:result.snapshot,extracted_records:records}});
    refs.push({snapshot_id:result.snapshot.snapshot_id,extracted_record_id:records[0]!.extracted_record_id,raw_sha256:result.raw_blob!.raw_content_sha256});
  }
  git(seed,"push","origin","HEAD:refs/heads/main");
  const detail=parts[2]!;
  const endpointVersion=detail.versions.find(item=>item.artifact.kind==="RECRUITMENT_ENDPOINT")!;
  if(endpointVersion.artifact.kind!=="RECRUITMENT_ENDPOINT")throw new Error("fixture");
  const root=()=>bootstrapZeroCostProductionCompositionRoot({execution_mode:"TEST_ONLY",remote_url:remote,branch:"main",stream_id:"TEST_ONLY:national-root",now:()=>now});
  const input={run_id:"TEST_ONLY:national-detail",source_versions:versions,source_admission_id:detail.claim.authorization.source_admission_id,
    recruitment_endpoint_id:endpointVersion.artifact.payload.recruitment_endpoint_id,
    adapter:new Chnenergy2027CampaignHtmlAdapter({campaign:refs[0]!,membership:refs[1]!}),transport:{async execute(){return response(detailHtml);}},
    provenance,actor:"TEST_ONLY",started_at:now};
  return {directory,seed,remote,git,input,refs,root,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}

test("actual root prepares v2 before canonical persistence and materializes exact retained packages before composition",async()=>{
  const current=await setup();
  try{
    const result=await current.root().runProduction(current.input);
    assert.equal(result.status,"COMMITTED",JSON.stringify(result));
    current.git(current.directory,"clone","--quiet","--branch","main",current.remote,path.join(current.directory,"readback"));
    const bundles=await new GitRawObjectPersistence({repository_path:path.join(current.directory,"readback")}).listVerifiedAcquisitions();
    const detail=bundles.find(bundle=>bundle.acquisition_run.acquisition_run_id.startsWith(current.input.run_id))!;
    assert.equal(detail.acquisition_run.result_metadata.extraction_status,"COMPLETE");
    assert.equal(detail.extracted_records[1]!.recruitment_year?.text,"2027");
    assert.equal(detail.extracted_records[1]!.recruitment_context?.recruitment_plan,undefined);
    const restored=await current.root().restore();
    assert.equal(restored.artifact_seals.filter(seal=>seal.artifact_kind==="SOURCE_OCCURRENCE_VERSION").length,4);
    assert.ok(restored.presentation_decisions.length>0);
    assert.ok(restored.presentation_decisions.every(decision=>decision.status==="EVIDENCE_BLOCKED"));
    assert.ok(restored.source_execution_outcomes.some(outcome=>outcome.trusted_chain_status==="COMMITTED"));
    const store=new GitAppendOnlyExecutionStore({repository_path:path.join(current.directory,"readback"),stream_id:"TEST_ONLY:national-root",scope:"PRODUCTION"});
    const composition=restored.artifact_seals.find(seal=>seal.artifact_kind==="SOURCE_COMPOSITION")!;
    assert.ok(composition);
    const envelope=await store.readArtifactEnvelope(composition.artifact_kind,composition.artifact_id,"PRODUCTION");
    assert.ok(envelope);
    assert.equal(JSON.parse(envelope.canonical_bytes).status,"UNRESOLVED");
  }finally{current.cleanup();}
});

test("tampered dependency SHA preserves actual response Raw and FAILED NOT_RUN outcome",async()=>{
  const current=await setup();
  try{
    const result=await current.root().runProduction({...current.input,adapter:new Chnenergy2027CampaignHtmlAdapter({
      campaign:{...current.refs[0]!,raw_sha256:"0".repeat(64)},membership:current.refs[1]!})});
    assert.equal(result.status,"FAILED");
    assert.ok(result.committed_head);
    assert.equal(result.raw_blob_ids.length,1);
    const restored=await current.root().restore();
    assert.equal(restored.source_execution_outcomes.at(-1)!.trusted_chain_status,"NOT_RUN");
    const readback=path.join(current.directory,"readback");
    current.git(current.directory,"clone","--quiet","--branch","main",current.remote,readback);
    const bundle=(await new GitRawObjectPersistence({repository_path:readback}).listVerifiedAcquisitions()).at(-1)!;
    assert.equal(bundle.snapshot.transport_status,"SUCCESS");
    assert.equal(bundle.acquisition_run.status,"SUCCESS");
    assert.equal(bundle.acquisition_run.result_metadata.extraction_status,"FAILED");
    assert.equal(bundle.extracted_records.length,0);
  }finally{current.cleanup();}
});

test("forged retained support role cannot issue PACKAGE authority and does not discard target Raw",async()=>{
  const current=await setup(true);
  try{
    const result=await current.root().runProduction(current.input);
    assert.equal(result.status,"FAILED");
    assert.ok(result.committed_head);
    assert.equal(result.raw_blob_ids.length,1);
    const restored=await current.root().restore();
    assert.equal(restored.source_execution_outcomes.at(-1)!.trusted_chain_status,"NOT_RUN");
    assert.equal(restored.artifact_seals.filter(seal=>seal.artifact_kind==="SOURCE_OCCURRENCE_VERSION").length,0);
  }finally{current.cleanup();}
});

test("other detail extraction failure is never upgraded to COMPLETE",async()=>{
  const current=await setup();
  try{
    const result=await current.root().runProduction({...current.input,transport:{async execute(){
      return response(detailHtml.replace("<li>专业要求：法学</li>",""));
    }}});
    assert.equal(result.status,"FAILED");
    assert.ok(result.committed_head);
    assert.equal(result.extracted_record_ids.length,0);
    const restored=await current.root().restore();
    assert.equal(restored.source_execution_outcomes.at(-1)!.trusted_chain_status,"NOT_RUN");
  }finally{current.cleanup();}
});
test("exact missing retained reference fails closed through the actual root",async()=>{
  const current=await setup();
  try{
    const result=await current.root().runProduction({...current.input,adapter:new Chnenergy2027CampaignHtmlAdapter({
      campaign:{...current.refs[0]!,snapshot_id:"TEST_ONLY:missing"},membership:current.refs[1]!})});
    assert.notEqual(result.status,"COMMITTED");
    assert.equal(result.restoration_record_ids.length,0);
    assert.ok(result.committed_head,"failed preparation must retain the actual acquisition authoritatively");
    assert.equal(result.raw_blob_ids.length,1);
    assert.equal(result.snapshot_ids.length,1);
    const restored=await current.root().restore();
    const outcome=restored.source_execution_outcomes.find(value=>value.source_execution_id===current.input.run_id)!;
    assert.equal(outcome.status,"FAILED");
    assert.equal(outcome.trusted_chain_status,"NOT_RUN");
    assert.equal(outcome.snapshot_ids.length,1);
    assert.equal(restored.acquisition_count,3);
  }finally{current.cleanup();}
});
