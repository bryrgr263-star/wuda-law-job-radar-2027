import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AdapterExtractionError,
  type AdapterExtractionInput,
  type RecruitmentAdapter,
  type RecruitmentEndpoint
} from "../../lib/ingestion";

export interface AdapterContractCases {
  readonly adapter: RecruitmentAdapter;
  readonly valid_endpoint: RecruitmentEndpoint;
  readonly invalid_http_endpoint: RecruitmentEndpoint;
  readonly html: AdapterExtractionInput;
  readonly json_page_1: AdapterExtractionInput;
  readonly json_page_2: AdapterExtractionInput;
  readonly document: AdapterExtractionInput;
  readonly empty: AdapterExtractionInput;
  readonly malformed: AdapterExtractionInput;
  readonly duplicate: AdapterExtractionInput;
  readonly failed: AdapterExtractionInput;
}

export function runAdapterContractTests(
  adapterName: string,
  setup: () => Promise<AdapterContractCases>
) {
  test(`${adapterName} contract: descriptor is complete and source-neutral`, async () => {
    const { adapter } = await setup();
    assert.ok(adapter.descriptor.adapter_key);
    assert.ok(adapter.descriptor.name);
    assert.ok(adapter.descriptor.version);
    assert.ok(adapter.descriptor.supported_content_kinds.length > 0);
    assert.ok(adapter.descriptor.capabilities.length > 0);
  });

  test(`${adapterName} contract: endpoint validation rejects real HTTP`, async () => {
    const { adapter, valid_endpoint, invalid_http_endpoint } = await setup();
    assert.equal(adapter.validateEndpoint(valid_endpoint).valid, true);
    const invalid = adapter.validateEndpoint(invalid_http_endpoint);
    assert.equal(invalid.valid, false);
    assert.match(invalid.issues.join(" "), /fixture:\/\//);
  });

  test(`${adapterName} contract: plan is source-neutral and starts at page one`, async () => {
    const { adapter, valid_endpoint } = await setup();
    const plans = adapter.plan(valid_endpoint);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].locator, valid_endpoint.locator);
    assert.equal(plans[0].method, null);
    assert.deepEqual(plans[0].parameters, {});
    assert.deepEqual(plans[0].pagination_state, {
      page_index: 1,
      cursor: null,
      visited_locators: [valid_endpoint.locator]
    });
  });

  test(`${adapterName} contract: extract returns source-level records only`, async () => {
    const { adapter, html } = await setup();
    const records = adapter.extract(html);
    assert.equal(records.length, 2);
    assert.equal(records[0].snapshot_id, html.snapshot.snapshot_id);
    assert.ok(records[0].raw_title);
    assert.ok(records[0].raw_organization_name);
    assert.ok(records[0].identity_candidates.length > 0);
    assert.equal("content" in records[0], false);
  });

  test(`${adapterName} contract: nextPage traverses page 1, page 2, then ends`, async () => {
    const { adapter, json_page_1, json_page_2 } = await setup();
    const initial = adapter.plan(json_page_1.endpoint)[0];
    const next = adapter.nextPage({
      endpoint: json_page_1.endpoint,
      snapshot: json_page_1.snapshot,
      pagination_state: initial.pagination_state
    });
    assert.ok(next);
    assert.equal(next.pagination_state.page_index, 2);
    assert.equal(next.locator, json_page_2.snapshot.request_metadata.locator);
    const end = adapter.nextPage({
      endpoint: json_page_2.endpoint,
      snapshot: json_page_2.snapshot,
      pagination_state: next.pagination_state
    });
    assert.equal(end, null);

    const records = [...adapter.extract(json_page_1), ...adapter.extract(json_page_2)];
    assert.deepEqual(records.map((record) => record.raw_source_record_id), [
      "json-risk-001",
      "json-audit-002"
    ]);
  });

  test(`${adapterName} contract: completeness distinguishes partial and complete`, async () => {
    const { adapter, json_page_1, json_page_2 } = await setup();
    const firstRecords = adapter.extract(json_page_1);
    assert.equal(adapter.assessCompleteness({
      snapshots: [json_page_1.snapshot],
      records: firstRecords,
      extraction_errors: []
    }).status, "PARTIAL");

    const allRecords = [...firstRecords, ...adapter.extract(json_page_2)];
    assert.equal(adapter.assessCompleteness({
      snapshots: [json_page_1.snapshot, json_page_2.snapshot],
      records: allRecords,
      extraction_errors: []
    }).status, "COMPLETE");
  });

  test(`${adapterName} contract: failed Snapshot cannot extract or create false success`, async () => {
    const { adapter, failed } = await setup();
    assert.throws(
      () => adapter.extract(failed),
      (error) => error instanceof AdapterExtractionError && error.code === "SNAPSHOT_FAILED"
    );
    assert.equal(adapter.assessCompleteness({
      snapshots: [failed.snapshot],
      records: [],
      extraction_errors: []
    }).status, "FAILED");
  });

  test(`${adapterName} contract: successful zero records is suspicious, not confirmed empty`, async () => {
    const { adapter, empty } = await setup();
    const records = adapter.extract(empty);
    assert.deepEqual(records, []);
    assert.equal(adapter.assessCompleteness({
      snapshots: [empty.snapshot],
      records,
      extraction_errors: []
    }).status, "SUSPICIOUS_EMPTY");
  });

  test(`${adapterName} contract: malformed input returns an explicit extraction failure`, async () => {
    const { adapter, malformed } = await setup();
    assert.throws(
      () => adapter.extract(malformed),
      (error) => error instanceof AdapterExtractionError && error.code === "MALFORMED_CONTENT"
    );
    assert.equal(adapter.assessCompleteness({
      snapshots: [malformed.snapshot],
      records: [],
      extraction_errors: [{
        snapshot_id: malformed.snapshot.snapshot_id,
        code: "MALFORMED_CONTENT",
        message: "Fixture content is malformed"
      }]
    }).status, "FAILED");
  });

  test(`${adapterName} contract: duplicate source records are not emitted twice`, async () => {
    const { adapter, duplicate } = await setup();
    const records = adapter.extract(duplicate);
    assert.equal(records.length, 1);
    assert.equal(records[0].raw_source_record_id, "duplicate-001");
  });

  test(`${adapterName} contract: adapter source has no network, database, legacy, scoring, or eligibility imports`, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const adapterRoot = path.join(repositoryRoot, "lib", "ingestion", "adapters");
    const fileNames = ["contract.ts", "errors.ts", "fixture-adapter.ts", "index.ts"];
    const forbidden = [
      "lib/crawler",
      "lib/source-catalog",
      "lib/sync",
      "lib/scoring",
      "supabase",
      "eligibility",
      "persistence"
    ];
    const violations: string[] = [];
    for (const fileName of fileNames) {
      const source = await readFile(path.join(adapterRoot, fileName), "utf8");
      const specifiers = [...source.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)]
        .map((match) => match[1]);
      for (const specifier of specifiers) {
        if (forbidden.some((entry) => specifier.toLowerCase().includes(entry))) {
          violations.push(`${fileName} -> ${specifier}`);
        }
      }
      if (/\bfetch\s*\(/.test(source)) violations.push(`${fileName} calls fetch`);
    }
    assert.deepEqual(violations, []);
  });

  test(`${adapterName} contract: network access remains disabled`, async () => {
    await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
  });
}
