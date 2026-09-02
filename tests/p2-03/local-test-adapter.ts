import {
  UTF8_TEXT_ENCODING,
  type AdapterCompletenessAssessment,
  type AdapterCompletenessInput,
  type AdapterDescriptor,
  type AdapterExtractionInput,
  type AdapterNextPageInput,
  type AdapterRequestPlan,
  type EndpointValidationResult,
  type ExtractedRecord,
  type RecruitmentAdapter,
  type RecruitmentEndpoint,
  type SourceRecordLocator
} from "../../lib/ingestion";

export class LocalJsonTestAdapter implements RecruitmentAdapter {
  readonly descriptor: AdapterDescriptor = {
    adapter_key: "p2-local-test",
    name: "P2LocalJsonTestAdapter",
    version: "1.0.0-test",
    supported_content_kinds: ["JSON"],
    capabilities: ["PAGINATION", "JSON_EXTRACTION"]
  };

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    return endpoint.adapter_key === this.descriptor.adapter_key && endpoint.content_kind === "JSON"
      ? { valid: true, issues: [] }
      : { valid: false, issues: ["Local test adapter accepts JSON p2-local-test endpoints only"] };
  }

  plan(endpoint: RecruitmentEndpoint): readonly AdapterRequestPlan[] {
    return [{
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: endpoint.locator,
      method: endpoint.request_method ?? "GET",
      parameters: {},
      pagination_state: { page_index: 1, cursor: null, visited_locators: [endpoint.locator] }
    }];
  }

  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    if (!input.raw_blob || input.snapshot.raw_blob_id !== input.raw_blob.raw_blob_id) {
      throw new Error("P2 local test adapter requires captured RawBlob before extraction");
    }
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.raw_blob.bytes)) as {
      readonly records: readonly { readonly id: string; readonly title: string }[];
    };
    return parsed.records.map((record, index) => {
      const source_record_locator: SourceRecordLocator = { kind: "JSON", json_path: `$.records[${index}]` };
      return {
        extracted_record_id: `p2-local:${input.snapshot.snapshot_id}:${record.id}` as ExtractedRecord["extracted_record_id"],
        snapshot_id: input.snapshot.snapshot_id,
        source_definition_id: input.endpoint.source_definition_id,
        identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: record.id, confidence: "HIGH" }],
        raw_source_record_id: record.id,
        raw_title: { text: record.title, encoding: UTF8_TEXT_ENCODING },
        raw_location_text: [],
        source_record_locator,
        adapter_metadata: { "p2-local-test": { test_only: true } },
        extraction: { extractor_name: "P2LocalJsonTestAdapter", extractor_version: "1.0.0-test", extracted_at: input.snapshot.observed_at }
      };
    });
  }

  nextPage(input: AdapterNextPageInput): AdapterRequestPlan | null {
    const nextLocator = input.snapshot.response_metadata.headers["x-p2-next-page"];
    if (!nextLocator) return null;
    if (nextLocator === "MALFORMED") throw new Error("Malformed test next page");
    return {
      recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
      locator: nextLocator,
      method: input.endpoint.request_method ?? "GET",
      parameters: {},
      pagination_state: {
        page_index: input.pagination_state.page_index + 1,
        cursor: nextLocator,
        visited_locators: [...input.pagination_state.visited_locators, nextLocator]
      }
    };
  }

  assessCompleteness(input: AdapterCompletenessInput): AdapterCompletenessAssessment {
    if (input.extraction_errors.length > 0 || input.snapshots.some((snapshot) => snapshot.transport_status === "FAILED")) {
      return { status: "FAILED", reason_codes: ["TEST_TRANSPORT_OR_EXTRACTION_FAILURE"] };
    }
    if (input.snapshots.at(-1)?.response_metadata.headers["x-p2-next-page"]) {
      return { status: "PARTIAL", reason_codes: ["TEST_NEXT_PAGE_UNCOLLECTED"] };
    }
    return input.records.length === 0
      ? { status: "SUSPICIOUS_EMPTY", reason_codes: ["TEST_ZERO_RECORDS"] }
      : { status: "COMPLETE", reason_codes: ["TEST_COMPLETE"] };
  }
}
