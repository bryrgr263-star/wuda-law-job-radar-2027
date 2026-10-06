import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovedQueryRequest, assertQueryAuthorizationContract, canonicalizeApprovedQueryTarget, sealQueryAuthorizationContract, type QueryAuthorizationContent } from "../../lib/application/source-admission/query-authorization";

function content(): QueryAuthorizationContent {
  return { schema_version: "query-authorization/2.0.0", base_exact_url: "https://official.invalid/jobs",
    parameters: [{ name: "page", required: true, allowed_values: ["1", "2", "3"] }],
    approved_combinations: [[{ name: "page", value: "1" }], [{ name: "page", value: "2" }]],
    pagination: { parameter: "page", minimum_page: 1, maximum_page: 3, ordering: "ASCENDING_INTEGER", empty_stop: "STOP", repeated_content_stop: "STOP" },
    maximum_pages: 3, request_budget: 4, canonicalization: "QUERY_ASCII_RFC3986_V1" };
}

test("finite contract seal is deterministic, defensive and detects tampering", () => {
  const input = content(); const sealed = sealQueryAuthorizationContract(input);
  assert.deepEqual(sealed, sealQueryAuthorizationContract(content()));
  assertQueryAuthorizationContract(sealed);
  input.parameters[0]!.allowed_values.push("4");
  assert.equal(sealed.parameters[0]!.allowed_values.length, 3);
  assert.throws(() => assertQueryAuthorizationContract({ ...sealed, request_budget: 5 }));
});

test("contracts reject unbounded, duplicate, unknown and excessive configuration", () => {
  const invalid: QueryAuthorizationContent[] = [
    { ...content(), parameters: [...content().parameters, content().parameters[0]!] },
    { ...content(), parameters: [{ name: "page", required: true, allowed_values: ["1", "1"] }] },
    { ...content(), approved_combinations: [] }, { ...content(), maximum_pages: 33 },
    { ...content(), request_budget: 65 }, { ...content(), base_exact_url: "https://official.invalid:8443/jobs" },
    { ...content(), parameters: [{ name: "token", required: false, allowed_values: ["secret"] }] },
    { ...content(), approved_combinations: [[{ name: "other", value: "1" }]] },
  ];
  for (const input of invalid) assert.throws(() => sealQueryAuthorizationContract(input));
  assert.throws(() => sealQueryAuthorizationContract({ ...content(), extra: true } as QueryAuthorizationContent));
});

test("approved exact query accepts only finite canonical values and combinations", () => {
  const contract = sealQueryAuthorizationContract(content());
  assert.equal(canonicalizeApprovedQueryTarget("https://official.invalid/jobs?page=2", contract), "https://official.invalid/jobs?page=2");
  for (const suffix of ["", "?page=02", "?page=3", "?page=5", "?page=2&page=2", "?%70age=2", "?page=%32", "?page=+2", "?page=2&x=1", "?page=2#x", "?page=2&", "?page=%FF"])
    assert.throws(() => canonicalizeApprovedQueryTarget(`https://official.invalid/jobs${suffix}`, contract));
  assert.throws(() => canonicalizeApprovedQueryTarget("https://other.invalid/jobs?page=2", contract));
});

test("ASCII order and RFC3986 encoding are deterministic; request validation never normalizes", () => {
  const contract = sealQueryAuthorizationContract({ ...content(), pagination: null, parameters: [
    { name: "z", required: true, allowed_values: ["甲", "!'()*"] }, { name: "a", required: true, allowed_values: ["1"] }],
    approved_combinations: [[{ name: "z", value: "甲" }, { name: "a", value: "1" }], [{ name: "z", value: "!'()*" }, { name: "a", value: "1" }]] });
  const unsorted = "https://official.invalid/jobs?z=%E7%94%B2&a=1";
  const canonical = "https://official.invalid/jobs?a=1&z=%E7%94%B2";
  assert.equal(canonicalizeApprovedQueryTarget(unsorted, contract), canonical);
  assert.throws(() => assertApprovedQueryRequest(unsorted, contract));
  assertApprovedQueryRequest(canonical, contract);
  for (const value of ["甲", "%e7%94%B2", "%E7%94%b2", "!'()*"]) assert.throws(() => canonicalizeApprovedQueryTarget(`https://official.invalid/jobs?a=1&z=${value}`, contract));
  assertApprovedQueryRequest("https://official.invalid/jobs?a=1&z=%21%27%28%29%2A", contract);
});
