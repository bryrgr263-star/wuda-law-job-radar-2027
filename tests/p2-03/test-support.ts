import http from "node:http";

import {
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  RawCaptureService,
  UTF8_TEXT_ENCODING,
  type RecruitmentEndpoint
} from "../../lib/ingestion";
import {
  CollectionRunner,
  LocalHttpTransport,
  createLocalHttpEgressPolicy,
  type CollectionRuntimeClock,
  type CollectionRuntimePolicy
} from "../../lib/collection-runtime";

import { LocalJsonTestAdapter } from "./local-test-adapter";

export async function startLocalTestServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local test server has no TCP address");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export function endpoint(locator: string): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: "p2-local-endpoint" as RecruitmentEndpoint["recruitment_endpoint_id"],
    source_definition_id: "p2-local-source" as RecruitmentEndpoint["source_definition_id"],
    name: { original: { text: "P2 本地测试来源", encoding: UTF8_TEXT_ENCODING } },
    coverage_regions: [],
    locator,
    request_method: "GET",
    content_kind: "JSON",
    adapter_key: "p2-local-test",
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {},
    enabled: true
  };
}

export function clock() {
  let milliseconds = 0;
  const waits: number[] = [];
  const value: CollectionRuntimeClock = {
    now: () => `2026-09-05T00:00:${String(Math.floor(milliseconds / 1000)).padStart(2, "0")}.000Z` as ReturnType<CollectionRuntimeClock["now"]>,
    now_ms: () => milliseconds,
    sleep: async (delay: number) => { waits.push(delay); milliseconds += delay; }
  };
  return { value, waits };
}

export function runner(origin: string, overrides: Partial<CollectionRuntimePolicy> = {}) {
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  const testClock = clock();
  const policy: CollectionRuntimePolicy = {
    timeout_ms: 100,
    retry_limit: 1,
    retry_backoff_ms: 5,
    rate_limit_ms: 10,
    max_pages: 5,
    request_budget: 8,
    ...overrides
  };
  return {
    runner: new CollectionRunner({
      transport: new LocalHttpTransport(createLocalHttpEgressPolicy([origin]), { now: testClock.value.now }),
      raw_capture: new RawCaptureService(rawBlobs, snapshots, { create_snapshot_id: (() => {
        let number = 0;
        return () => `p2-snapshot-${++number}` as never;
      })() }),
      policy,
      clock: testClock.value
    }),
    adapter: new LocalJsonTestAdapter(),
    waits: testClock.waits,
    rawBlobs,
    snapshots
  };
}
