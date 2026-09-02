# Phase 2 Collection Runtime

## P2-03 Scope

P2-03 adds a separate `lib/collection-runtime/` layer so that the frozen P2-01 `lib/application/` boundary remains network-free. The runtime depends downstream on frozen `lib/ingestion/` contracts only; P1, source admission, Preview Persistence, legacy production code, and web/API code do not import it.

`CollectionRunner` is an in-memory runtime object. It creates a collection-run result, transitions `CREATED → RUNNING → COMPLETED`, executes finite Adapter request plans, records retries and page state, and returns snapshots, RawBlob references, ExtractedRecords, and conservative terminal classification. It does not persist Source Run data or use the P1 Missing Guard; P2-06 is the first persistence stage for Source Run, observations, and missing streaks.

## Local HTTP Contract

`LocalHttpTransport` accepts a source-neutral request method, URL, headers, parameters, optional body, timeout, response status, content type, exact bytes, retryability, and failure code. It does not parse recruitment data, evaluate requirements/eligibility, canonicalize, or create an Adapter.

Egress is `P2_03_LOCAL_TEST` only. A caller must configure one or more exact `http://` or `https://` loopback origins (`127.0.0.1`, `::1`, or `localhost`). Public origins, non-whitelisted local endpoints, URL credentials, sensitive headers/parameters, and automatic URL expansion are denied before a request is issued. There is no P2-04 Live Canary execution path.

## Bounds and Classification

Every run has finite timeout, retry limit, exponential retry backoff, minimum request interval, maximum pages, and request budget. Repeated pages, malformed next pages, page limits, and budget exhaustion are `PARTIAL`. Failed transport or extraction remains `FAILED`; a failed retry attempt is retained as a failed Snapshot and cannot be silently upgraded to `SUCCESS`. A complete zero-record extraction remains `SUSPICIOUS_EMPTY`, never a recruitment-closed signal.

For successful HTTP responses, P1 `RawCaptureService` captures exact bytes and creates RawBlob/Snapshot before the Adapter receives any input. Failed responses create failed Snapshots with no artificial RawBlob. The only server in P2-03 tests is an in-process loopback test server; public targets are rejected without network access. No external recruitment source, production database, Storage, Adapter, runner scheduling, API, or Web implementation is included.
