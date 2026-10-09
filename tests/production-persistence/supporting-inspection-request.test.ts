import "../helpers/network-guard";
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import childProcess from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as gate from "../../lib/production-persistence/continuous-request-gate";
import type { HttpTransportRequest } from "../../lib/collection-runtime/types";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { sealQueryAuthorizationContract } from "../../lib/application/source-admission/query-authorization";
import { fixture as continuousFixture, AT, LATER, provenance, identity } from "./continuous-acquisition-fixture";

function fixture() {
  const original = continuousFixture();
  const exactUrl = "https://example.invalid/recruitment?id=TEST_ONLY";
  const query = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0",
    base_exact_url: "https://example.invalid/recruitment", parameters: [{ name: "id", required: true, allowed_values: ["TEST_ONLY"] }],
    approved_combinations: [[{ name: "id", value: "TEST_ONLY" }]], pagination: null, maximum_pages: 1, request_budget: 1,
    canonicalization: "QUERY_ASCII_RFC3986_V1" });
  const { continuous_acquisition_scope, ...base } = original.admitted;
  const admission = { ...base, endpoint: exactUrl, automation_basis: "HUMAN_REVIEWED_CANARY" as const,
    evidence: base.evidence.map(item => ({ ...item, endpoint: exactUrl, source_url: exactUrl })) };
  const endpoint = { ...original.endpoint, locator: exactUrl,
    collection_config: { ...original.endpoint.collection_config, max_items: 1, max_pages: 1, retry_limit: 0, follow_redirects: false } };
  const versions: SourcePersistenceVersion[] = [];
  for (const source of original.versions) {
    let artifact = source.artifact;
    if (artifact.kind === "RECRUITMENT_ENDPOINT") artifact = { kind: artifact.kind, payload: endpoint };
    if (artifact.kind === "SOURCE_ADMISSION") artifact = { kind: artifact.kind, payload: admission };
    if (artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST") artifact = { kind: artifact.kind, payload: { ...artifact.payload,
      recruitment_endpoint_artifact_id: versions.find(item => item.artifact.kind === "RECRUITMENT_ENDPOINT")!.artifact_id,
      source_admission_artifact_id: versions.find(item => item.artifact.kind === "SOURCE_ADMISSION")!.artifact_id,
      query_policy: { mode: "FINITE_VALUES", contract: query } } };
    versions.push(createSourcePersistenceVersion({ stream_id: source.stream_id, revision: 1, supersedes_artifact_id: null,
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

function request(current: ReturnType<typeof setup>): HttpTransportRequest {
  return { recruitment_endpoint_id: current.current.claim.authorization.recruitment_endpoint_id as HttpTransportRequest["recruitment_endpoint_id"],
    locator: current.current.claim.exact_url, method: "GET", requested_at: new Date().toISOString() as HttpTransportRequest["requested_at"],
    headers: {}, parameters: {}, timeout_ms: 1000 };
}
async function execute(current: ReturnType<typeof setup>, parent: string, input = request(current), claim = version(current.current.claim)) {
  const helper = (gate as unknown as { executeSupportingInspectionRequest?: (options: unknown, request: HttpTransportRequest) => Promise<{ response: {status:string}; committed_claim_head:string }> }).executeSupportingInspectionRequest;
  assert.ok(helper, "supporting inspection send gate must exist");
  return helper({ repository_path: current.seed, branch: "main", expected_parent: parent, claim, commit_identity: identity,
    collection_run_id: current.current.claim.authorization.collection_run_id }, input);
}

test("publishes one claim then uses the same strict HTTP path exactly once; claim remains unresolved", async () => {
  const current = setup();
  try {
    const parent = await current.initialize();
    const intercepted = mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
      const repository = new GitSourceRegistryPersistence({repository_path:current.seed});
      const versions = await repository.listVersions();
      assert.equal(versions.at(-1)!.artifact.kind, "SUPPORTING_INSPECTION_EXECUTION");
      repository.assertAuthoritativeHead("main", repository.readCommittedHead());
      assert.equal(options?.redirect, "manual");
      assert.equal(options?.credentials, "omit");
      return new Response("TEST_ONLY", {status:200, headers:{"content-type":"text/html"}});
    });
    try {
      const result = await execute(current,parent);
      assert.equal(result.response.status,"SUCCESS");
      assert.equal(result.committed_claim_head,current.git(current.remote,"rev-parse","refs/heads/main"));
      await assert.rejects(execute(current,result.committed_claim_head));
      assert.equal(intercepted.mock.callCount(),1);
    } finally {intercepted.mock.restore();}
  } finally {current.cleanup();}
});

test("future claim, wrong request and dirty source reject without fetching or publishing", async () => {
  for (const mutation of ["future","url","headers","dirty","endpoint","run","authority","budget","invalid-time","stale"] as const) {
    const current=setup();
    try {
      const parent=await current.initialize();
      const input=request(current);
      let claim=version(current.current.claim);
      if(mutation==="future") claim=version({...current.current.claim,claimed_at:"2099-01-01T00:00:00.000Z"});
      if(mutation==="url") Object.assign(input,{locator:input.locator+"other"});
      if(mutation==="headers") Object.assign(input,{headers:{Cookie:"TEST_ONLY"}});
      if(mutation==="endpoint") Object.assign(input,{recruitment_endpoint_id:"TEST_ONLY:wrong"});
      if(mutation==="run") claim=version({...current.current.claim,authorization:{...current.current.claim.authorization,collection_run_id:"TEST_ONLY:wrong"}});
      if(mutation==="authority") claim=version({...current.current.claim,bindings:{...current.current.claim.bindings,source_artifact_id:"0".repeat(64)}});
      if(mutation==="budget") claim=version({...current.current.claim,query_contract_hash:"0".repeat(64)});
      if(mutation==="invalid-time") Object.assign(input,{requested_at:"invalid"});
      const expected=mutation==="stale"?"0".repeat(40):parent;
      if(mutation==="dirty") writeFileSync(path.join(current.seed,"README.md"),"dirty");
      const intercepted=mock.method(globalThis,"fetch",async()=>{throw new Error("must not fetch");});
      try {await assert.rejects(execute(current,expected,input,claim));assert.equal(intercepted.mock.callCount(),0);}
      finally {intercepted.mock.restore();}
      assert.equal(current.git(current.remote,"rev-parse","refs/heads/main"),parent);
    } finally {current.cleanup();}
  }
});

test("send exception leaves CLAIMED durable and cannot retry",async()=>{
  const current=setup();
  try {
    const parent=await current.initialize();
    const intercepted=mock.method(globalThis,"fetch",async()=>{throw new Error("TEST_ONLY_SEND_UNKNOWN");});
    try {
      await assert.rejects(execute(current,parent),/SEND_UNKNOWN/);
      const head=current.git(current.remote,"rev-parse","refs/heads/main");
      assert.notEqual(head,parent);
      await assert.rejects(execute(current,head));
      assert.equal(intercepted.mock.callCount(),1);
      const versions=await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions();
      const last=versions.at(-1)!.artifact;
      assert.equal(last.kind,"SUPPORTING_INSPECTION_EXECUTION");
      if(last.kind==="SUPPORTING_INSPECTION_EXECUTION") assert.equal(last.payload.state,"CLAIMED");
    } finally {intercepted.mock.restore();}
  } finally {current.cleanup();}
});

test("fresh pre-send owner rejects dirty state introduced after publication readback",async()=>{
  const current=setup();
  try {
    const parent=await current.initialize();
    const original=GitSourceRegistryPersistence.prototype.assertAuthoritativeHead;
    let publishedChecks=0;
    const authority=mock.method(GitSourceRegistryPersistence.prototype,"assertAuthoritativeHead",function(this:GitSourceRegistryPersistence,branch:string,head:string){
      original.call(this,branch,head);
      if(head!==parent && ++publishedChecks===2) writeFileSync(path.join(current.seed,"README.md"),"TEST_ONLY dirty after publication");
    });
    const transport=mock.method(globalThis,"fetch",async()=>{throw new Error("must not send");});
    try {
      await assert.rejects(execute(current,parent),/DIRTY/);
      assert.equal(transport.mock.callCount(),0);
      assert.notEqual(current.git(current.remote,"rev-parse","refs/heads/main"),parent);
    } finally {authority.mock.restore();transport.mock.restore();}
  } finally {current.cleanup();}
});

test("policy response stops without receipt finalization and offline guard cannot be bypassed",async()=>{
  for(const policy of ["redirect","offline"] as const){
    const current=setup();
    try {
      const parent=await current.initialize();
      if(policy==="offline") await assert.rejects(execute(current,parent),/Network access is disabled/);
      else {
        const transport=mock.method(globalThis,"fetch",async()=>new Response(null,{status:302,headers:{location:"https://unapproved.invalid/"}}));
        try {const result=await execute(current,parent);assert.equal(result.response.status,"FAILED");assert.equal(transport.mock.callCount(),1);}
        finally {transport.mock.restore();}
      }
      const versions=await new GitSourceRegistryPersistence({repository_path:current.seed}).listVersions();
      const last=versions.at(-1)!.artifact;
      assert.equal(last.kind,"SUPPORTING_INSPECTION_EXECUTION");
      if(last.kind==="SUPPORTING_INSPECTION_EXECUTION") assert.equal(last.payload.state,"CLAIMED");
    } finally {current.cleanup();}
  }
});

test("source HEAD advancement between fresh readback and send prevents dispatch",async()=>{
  const current=setup();
  try {
    const parent=await current.initialize();
    const original=GitSourceRegistryPersistence.prototype.assertAuthoritativeHead;
    let checks=0;
    const authority=mock.method(GitSourceRegistryPersistence.prototype,"assertAuthoritativeHead",function(this:GitSourceRegistryPersistence,branch:string,head:string){
      original.call(this,branch,head);
      if(head!==parent && ++checks===3){
        current.git(current.seed,"-c",`user.name=${identity.name}`,"-c",`user.email=${identity.email}`,"commit","--allow-empty","-qm","TEST_ONLY newer source head");
        current.git(current.seed,"push","origin","HEAD:refs/heads/main");
      }
    });
    const transport=mock.method(globalThis,"fetch",async()=>{throw new Error("must not send");});
    try {await assert.rejects(execute(current,parent));assert.equal(transport.mock.callCount(),0);}
    finally {authority.mock.restore();transport.mock.restore();}
  } finally {current.cleanup();}
});

test("persisted finite query budget above one is not send authority",async()=>{
  const current=setup();
  try {
    const position=current.current.versions.findIndex(item=>item.artifact.kind==="OFFICIAL_ENDPOINT_ALLOWLIST");
    const prior=current.current.versions[position]!;
    if(prior.artifact.kind!=="OFFICIAL_ENDPOINT_ALLOWLIST" || prior.artifact.payload.query_policy.mode!=="FINITE_VALUES") throw new Error("fixture");
    const {contract_hash,...payload}=prior.artifact.payload.query_policy.contract;
    const contract=sealQueryAuthorizationContract({...payload,request_budget:2});
    const changed=createSourcePersistenceVersion({stream_id:prior.stream_id,revision:1,supersedes_artifact_id:null,
      artifact:{kind:"OFFICIAL_ENDPOINT_ALLOWLIST",payload:{...prior.artifact.payload,query_policy:{mode:"FINITE_VALUES",contract}}},
      provenance,effective_at:AT,created_at:AT});
    current.current.versions[position]=changed;
    current.current.claim.bindings.allowlist_artifact_id=changed.artifact_id;
    current.current.claim.query_contract_hash=contract.contract_hash;
    const parent=await current.initialize();
    const transport=mock.method(globalThis,"fetch",async()=>{throw new Error("must not send");});
    try {await assert.rejects(execute(current,parent));assert.equal(transport.mock.callCount(),0);}
    finally {transport.mock.restore();}
    assert.equal(current.git(current.remote,"rev-parse","refs/heads/main"),parent);
  } finally {current.cleanup();}
});
