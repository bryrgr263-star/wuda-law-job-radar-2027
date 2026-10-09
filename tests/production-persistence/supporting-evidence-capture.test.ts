import "../helpers/network-guard";
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import childProcess from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as capture from "../../lib/production-persistence/supporting-evidence-capture";
import { chnenergySupportingEndpoint, CHNENERGY_SUPPORT_ADAPTER_KEY } from "../../lib/production-sources/chnenergy-supporting-evidence";
import { CHNENERGY_CAMPAIGN_URL } from "../../lib/production-sources/chnenergy-2027-source";
import { GitRawObjectPersistence } from "../../lib/production-persistence/git-raw-object-persistence";
import { isExtractedRecordV2 } from "../../lib/ingestion/normalization/extracted-record-identity";
import type { HttpTransportRequest } from "../../lib/collection-runtime/types";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { canonicalSerialize, canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { sealQueryAuthorizationContract } from "../../lib/application/source-admission/query-authorization";
import { fixture as continuousFixture, AT, LATER, provenance, identity } from "./continuous-acquisition-fixture";

function fixture() {
  const original = continuousFixture();
  const exactUrl = CHNENERGY_CAMPAIGN_URL;
  const query = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0",
    base_exact_url: exactUrl.split("?")[0]!, parameters: [{ name: "id", required: true, allowed_values: [new URL(exactUrl).searchParams.get("id")!] }],
    approved_combinations: [[{ name: "id", value: new URL(exactUrl).searchParams.get("id")! }]], pagination: null, maximum_pages: 1, request_budget: 1,
    canonicalization: "QUERY_ASCII_RFC3986_V1" });
  const { continuous_acquisition_scope, ...base } = original.admitted;
  const admission = { ...base, recruitment_endpoint_id: chnenergySupportingEndpoint(exactUrl).recruitment_endpoint_id, endpoint: exactUrl, automation_basis: "HUMAN_REVIEWED_CANARY" as const,
    evidence: base.evidence.map(item => ({ ...item, endpoint: exactUrl, source_url: exactUrl })) };
  const endpoint = { ...chnenergySupportingEndpoint(exactUrl), locator: exactUrl,
    collection_config: { ...original.endpoint.collection_config, max_items: 1, max_pages: 1, retry_limit: 0, follow_redirects: false } };
  const versions: SourcePersistenceVersion[] = [];
  for (const source of original.versions) {
    let artifact = source.artifact;
    if (artifact.kind === "SOURCE_DEFINITION") artifact = { kind: artifact.kind, payload: {...artifact.payload, source_definition_id:endpoint.source_definition_id} };
    if (artifact.kind === "ADAPTER_REGISTRATION") artifact = { kind: artifact.kind, payload: {...artifact.payload,adapter_key:CHNENERGY_SUPPORT_ADAPTER_KEY} };
    if (artifact.kind === "RECRUITMENT_ENDPOINT") artifact = { kind: artifact.kind, payload: endpoint };
    if (artifact.kind === "SOURCE_ADMISSION") artifact = { kind: artifact.kind, payload: admission };
    if (artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST") artifact = { kind: artifact.kind, payload: { ...artifact.payload,
      recruitment_endpoint_artifact_id: versions.find(item => item.artifact.kind === "RECRUITMENT_ENDPOINT")!.artifact_id,
      source_admission_artifact_id: versions.find(item => item.artifact.kind === "SOURCE_ADMISSION")!.artifact_id,
      host:new URL(exactUrl).hostname,path_prefix:new URL(exactUrl).pathname,
      query_policy: { mode: "FINITE_VALUES", contract: query } } };
    versions.push(createSourcePersistenceVersion({ stream_id: artifact.kind === "SOURCE_DEFINITION" ? endpoint.source_definition_id : artifact.kind === "ADAPTER_REGISTRATION" ? CHNENERGY_SUPPORT_ADAPTER_KEY : artifact.kind === "RECRUITMENT_ENDPOINT" ? endpoint.recruitment_endpoint_id : source.stream_id, revision: 1, supersedes_artifact_id: null,
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

function version(payload: object, prior?: SourcePersistenceVersion) {
  return createSourcePersistenceVersion({ stream_id: Reflect.get(payload, "authorization").authorization_id,
    revision: (prior?.revision ?? 0) + 1, supersedes_artifact_id: prior?.artifact_id ?? null,
    artifact: { kind: "SUPPORTING_INSPECTION_EXECUTION", payload } as unknown as SourcePersistenceVersion["artifact"],
    provenance, effective_at: Reflect.get(payload, "claimed_at"), created_at: Reflect.get(payload, "claimed_at") });
}

function setup() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "inspection-publisher-TEST_ONLY-"));
  const seed = path.join(directory, "seed");
  const remote = path.join(directory, "remote.git");
  mkdirSync(seed);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(directory, "init", "--quiet", "--bare", remote);
  git(seed, "init", "--quiet", "-b", "main");
  writeFileSync(path.join(seed, "README.md"), "TEST_ONLY\n");
  const commit = () => { git(seed, "add", "--", "."); git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "TEST_ONLY fixture"); };
  commit();
  git(seed, "remote", "add", "origin", remote);
  const current = fixture();
  const initialize = async () => {
    const repository = new GitSourceRegistryPersistence({ repository_path: seed });
    for (const source of current.versions) await repository.appendVersion(source);
    commit();
    git(seed, "push", "origin", "HEAD:refs/heads/main");
    return git(seed, "rev-parse", "HEAD");
  };
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  return { directory, seed, remote, current, git, commit, initialize, cleanup };
}


const html='<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p><div id="anncTxt"><p>TEST_ONLY 年龄条件必须保留</p><a href="/annc/showggStationList?id=6a152f40-7fe5-460e-ad37-0024acafd8c9">招聘岗位</a></div>';
async function run(current:ReturnType<typeof setup>,parent:string,sourceVersions:readonly SourcePersistenceVersion[]=current.current.versions) {
  const helper=(capture as unknown as {captureSupportingEvidence?:(options:unknown)=>Promise<{claim_head:string;raw_head:string;receipt_head:string;extraction_status:string;acquisition_bundle_hash:string}>}).captureSupportingEvidence;
  assert.ok(helper,"existing-owner capture function must exist");
  return helper({repository_path:current.seed,branch:"main",expected_parent:parent,claim:version(current.current.claim),commit_identity:identity,
    collection_run_id:current.current.claim.authorization.collection_run_id,source_versions:sourceVersions});
}
test("actual transport yields linear claim Raw receipt commits and canonical support evidence only",async()=>{
  const current=setup();
  try {
    const parent=await current.initialize();
    const fetcher=mock.method(globalThis,"fetch",async()=>new Response(html,{status:200,headers:{"content-type":"text/html;charset=UTF-8"}}));
    try {
      const result=await run(current,parent);
      assert.equal(fetcher.mock.callCount(),1);
      assert.equal(current.git(current.seed,"rev-parse",result.raw_head+"^"),result.claim_head);
      assert.equal(current.git(current.seed,"rev-parse",result.receipt_head+"^"),result.raw_head);
      assert.equal(current.git(current.remote,"rev-parse","refs/heads/main"),result.receipt_head);
      const [bundle]=await new GitRawObjectPersistence({repository_path:current.seed}).listVerifiedAcquisitions();
      assert.equal(bundle!.extracted_records.length,1);
      const canonicalRecord=bundle!.extracted_records[0]!;
      assert.ok(isExtractedRecordV2(canonicalRecord));
      assert.equal(canonicalRecord.extraction.schema_version,CHNENERGY_SUPPORT_ADAPTER_KEY+"-extracted-record/2.0.0");
      assert.match(bundle!.extracted_records[0]!.raw_description!.text,/年龄条件必须保留/);
      const last=(await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions()).at(-1)!.artifact;
      assert.equal(last.kind,"SUPPORTING_INSPECTION_EXECUTION");
      if(last.kind==="SUPPORTING_INSPECTION_EXECUTION" && last.payload.state==="RECEIPT"){
        assert.equal(last.payload.receipt.acquisition_bundle_hash,canonicalHash(bundle));
        assert.equal(last.payload.receipt.response_received_at,bundle!.acquisition_run.completed_at);
        assert.equal(last.payload.receipt.request_started_at,bundle!.acquisition_run.started_at);
      } else assert.fail("actual receipt required");
      await assert.rejects(run(current,result.receipt_head));
      assert.equal(fetcher.mock.callCount(),1);
    } finally {fetcher.mock.restore();}
  } finally {current.cleanup();}
});
test("gate throw preserves unresolved claim without synthetic capture or receipt",async()=>{
  const current=setup();
  try {
    const parent=await current.initialize();
    const fetcher=mock.method(globalThis,"fetch",async()=>{throw new Error("TEST_ONLY_SEND_UNKNOWN");});
    try {await assert.rejects(run(current,parent),/SEND_UNKNOWN/);}
    finally {fetcher.mock.restore();}
    assert.equal((await new GitRawObjectPersistence({repository_path:current.seed}).listVerifiedAcquisitions()).length,0);
    const last=(await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions()).at(-1)!.artifact;
    if(last.kind==="SUPPORTING_INSPECTION_EXECUTION") assert.equal(last.payload.state,"CLAIMED"); else assert.fail();
  } finally {current.cleanup();}
});
test("parser failure preserves successful Raw but never claims extraction COMPLETE",async()=>{
  const current=setup();
  try{
    const parent=await current.initialize();
    const fetcher=mock.method(globalThis,"fetch",async()=>new Response("<p>TEST_ONLY invalid body</p>",{status:200,headers:{"content-type":"text/html"}}));
    try {
      const result=await run(current,parent);
      assert.equal(result.extraction_status,"FAILED");
      const [bundle]=await new GitRawObjectPersistence({repository_path:current.seed}).listVerifiedAcquisitions();
      assert.equal(bundle!.acquisition_run.status,"SUCCESS");
      assert.equal(bundle!.acquisition_run.result_metadata.extraction_status,"FAILED");
      assert.equal(bundle!.extracted_records.length,0);
    } finally{fetcher.mock.restore();}
  } finally{current.cleanup();}
});
test("actual policy failure persists failed Snapshot and honest receipt with no Raw object",async()=>{
  const current=setup();
  try{
    const parent=await current.initialize();
    const fetcher=mock.method(globalThis,"fetch",async()=>new Response(null,{status:401}));
    try{
      await run(current,parent);
      const [bundle]=await new GitRawObjectPersistence({repository_path:current.seed}).listVerifiedAcquisitions();
      assert.equal(bundle!.snapshot.transport_status,"FAILED");
      assert.equal(bundle!.raw_blob_manifest,null);
      const last=(await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions()).at(-1)!.artifact;
      if(last.kind==="SUPPORTING_INSPECTION_EXECUTION"&&last.payload.state==="RECEIPT") assert.equal(last.payload.receipt.transport_status,"FAILED");else assert.fail();
    }finally{fetcher.mock.restore();}
  }finally{current.cleanup();}
});

test("Raw push rejection or lost acknowledgement never publishes a terminal receipt",async()=>{
  for(const lostAck of [false,true]){
    const current=setup();
    try{
      const parent=await current.initialize();
      const fetcher=mock.method(globalThis,"fetch",async()=>new Response(html,{status:200,headers:{"content-type":"text/html"}}));
      const actual=childProcess.execFileSync;
      let pushes=0;
      const interception=mock.method(childProcess,"execFileSync",((command:unknown,args:unknown,options:unknown)=>{
        if(command==="git"&&Array.isArray(args)&&args[0]==="push"&&++pushes===2){
          if(lostAck) Reflect.apply(actual,childProcess,[command,args,options]);
          throw new Error("TEST_ONLY_RAW_PUSH_UNKNOWN");
        }
        return Reflect.apply(actual,childProcess,[command,args,options]);
      }) as typeof childProcess.execFileSync);
      try{await assert.rejects(run(current,parent),/PUSH_UNKNOWN/);}
      finally{interception.mock.restore();fetcher.mock.restore();}
      assert.equal(pushes,2);
      const last=(await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions()).at(-1)!.artifact;
      if(last.kind==="SUPPORTING_INSPECTION_EXECUTION")assert.equal(last.payload.state,"CLAIMED");else assert.fail();
      const head=current.git(current.remote,"rev-parse","refs/heads/main");
      await assert.rejects(run(current,head));
    }finally{current.cleanup();}
  }
});

test("tampered independent Raw readback refuses receipt publication",async()=>{
  const current=setup();
  try{
    const parent=await current.initialize();
    const fetcher=mock.method(globalThis,"fetch",async()=>new Response(html,{status:200,headers:{"content-type":"text/html"}}));
    const original=GitRawObjectPersistence.prototype.listVerifiedAcquisitions;
    const reader=mock.method(GitRawObjectPersistence.prototype,"listVerifiedAcquisitions",async function(this:GitRawObjectPersistence){
      const bundles=await original.call(this);
      return bundles.map(bundle=>({...bundle,acquisition_run:{...bundle.acquisition_run,endpoint_artifact_id:"TEST_ONLY:forged"}}));
    });
    try{await assert.rejects(run(current,parent),/RAW_READBACK_DENIED/);}
    finally{reader.mock.restore();fetcher.mock.restore();}
    const last=(await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions()).at(-1)!.artifact;
    if(last.kind==="SUPPORTING_INSPECTION_EXECUTION")assert.equal(last.payload.state,"CLAIMED");else assert.fail();
  }finally{current.cleanup();}
});

test("receipt push rejection or lost acknowledgement is not retried or rearmed",async()=>{
  for(const lostAck of [false,true]){
    const current=setup();
    try{
      const parent=await current.initialize();
      const fetcher=mock.method(globalThis,"fetch",async()=>new Response(html,{status:200,headers:{"content-type":"text/html"}}));
      const actual=childProcess.execFileSync;
      let pushes=0;
      const interception=mock.method(childProcess,"execFileSync",((command:unknown,args:unknown,options:unknown)=>{
        if(command==="git"&&Array.isArray(args)&&args[0]==="push"&&++pushes===3){
          if(lostAck) Reflect.apply(actual,childProcess,[command,args,options]);
          throw new Error("TEST_ONLY_RECEIPT_PUSH_UNKNOWN");
        }
        return Reflect.apply(actual,childProcess,[command,args,options]);
      }) as typeof childProcess.execFileSync);
      try{await assert.rejects(run(current,parent),/RECEIPT_PUSH_UNKNOWN/);}
      finally{interception.mock.restore();fetcher.mock.restore();}
      assert.equal(pushes,3);
      const remoteHead=current.git(current.remote,"rev-parse","refs/heads/main");
      const remoteState=JSON.parse(current.git(current.remote,"show",remoteHead+":production-source-state/state/current.json"));
      assert.ok(remoteState);
      assert.equal((await new GitRawObjectPersistence({repository_path:current.seed}).listVerifiedAcquisitions()).length,1);
      await assert.rejects(run(current,remoteHead));
    }finally{current.cleanup();}
  }
});

test("fresh process restores exact canonical bundle and terminal receipt without capture memory",async()=>{
  const current=setup();
  try{
    const parent=await current.initialize();
    const fetcher=mock.method(globalThis,"fetch",async()=>new Response(html,{status:200,headers:{"content-type":"text/html"}}));
    let result:Awaited<ReturnType<typeof run>>;
    try{result=await run(current,parent);}finally{fetcher.mock.restore();}
    const code=`const {GitRawObjectPersistence}=require('./lib/production-persistence/git-raw-object-persistence.ts');
      const {GitSourceRegistryPersistence}=require('./lib/production-persistence/git-source-registry-persistence.ts');
      const {canonicalHash}=require('./lib/ingestion/normalization/canonical-artifact-registry.ts');
      Promise.all([new GitRawObjectPersistence({repository_path:process.argv[1]}).listVerifiedAcquisitions(),
        new GitSourceRegistryPersistence({repository_path:process.argv[1]}).listVersions()])
        .then(([bundles,versions])=>process.stdout.write(JSON.stringify({hash:canonicalHash(bundles[0]),state:versions.at(-1).artifact.payload.state})))
        .catch(()=>{process.exitCode=1;});`;
    const restored=JSON.parse(execFileSync(process.execPath,["--import","tsx","-e",code,current.seed],{cwd:process.cwd(),encoding:"utf8",windowsHide:true}));
    assert.equal(restored.hash,result.acquisition_bundle_hash);
    assert.equal(restored.state,"RECEIPT");
  }finally{current.cleanup();}
});

test("capture rejects stale HEAD dirty worktree and tampered supplied versions before send",async()=>{
  for(const mutation of ["head","dirty","versions"] as const){
    const current=setup();
    try{
      const parent=await current.initialize();
      if(mutation==="dirty")writeFileSync(path.join(current.seed,"README.md"),"TEST_ONLY dirty");
      const sourceVersions=mutation==="versions"?current.current.versions.slice(1):current.current.versions;
      const fetcher=mock.method(globalThis,"fetch",async()=>{throw new Error("must not send");});
      try{
        await assert.rejects(run(current,mutation==="head"?"0".repeat(40):parent,sourceVersions));
        assert.equal(fetcher.mock.callCount(),0);
      }finally{fetcher.mock.restore();}
      assert.equal(current.git(current.remote,"rev-parse","refs/heads/main"),parent);
    }finally{current.cleanup();}
  }
});

test("HEAD advancement or dirty state at Raw verification leaves receipt unpublished",async()=>{
  for(const mutation of ["head","dirty"] as const){
    const current=setup();
    try{
      const parent=await current.initialize();
      const fetcher=mock.method(globalThis,"fetch",async()=>new Response(html,{status:200,headers:{"content-type":"text/html"}}));
      const original=GitRawObjectPersistence.prototype.listVerifiedAcquisitions;
      let changed=false;
      const reader=mock.method(GitRawObjectPersistence.prototype,"listVerifiedAcquisitions",async function(this:GitRawObjectPersistence){
        const bundles=await original.call(this);
        if(!changed){
          changed=true;
          if(mutation==="dirty")writeFileSync(path.join(current.seed,"README.md"),"TEST_ONLY dirty before receipt");
          else {
            current.git(current.seed,"-c",`user.name=${identity.name}`,"-c",`user.email=${identity.email}`,"commit","--allow-empty","-qm","TEST_ONLY competing HEAD");
            current.git(current.seed,"push","origin","HEAD:refs/heads/main");
          }
        }
        return bundles;
      });
      try{await assert.rejects(run(current,parent));}
      finally{reader.mock.restore();fetcher.mock.restore();}
      const last=(await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions()).at(-1)!.artifact;
      if(last.kind==="SUPPORTING_INSPECTION_EXECUTION")assert.equal(last.payload.state,"CLAIMED");else assert.fail();
    }finally{current.cleanup();}
  }
});
