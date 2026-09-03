# P2-07 Read-only Runtime Composition

This composition bridges the existing P2-07 in-process API to a future P2-08 Preview without changing the P2-07 endpoint contract.

The dependency direction is strictly:

```text
P2-08 Web Preview
  -> P2-07 Read-only Runtime / API
  -> Immutable Preview Data Source
```

The runtime receives a prebuilt SQLite dataset plus a manifest. It verifies the dataset byte length and SHA-256, requires the `VERIFIED_OFFICIAL_CAPTURE_ONLY` classification, opens SQLite with `readOnly: true`, enables connection-level `query_only`, and injects the connection into the existing `ReadOnlyIngestionProjection`. The runtime exposes only the P2-07 `handle()` operation, immutable dataset metadata, and lifecycle `close()`.

The first immutable dataset is prepared once, outside every Web request, from the SHA-256-verified P2-04D Beijing Raw and its approved Canary metadata. The preparation command uses the existing Beijing detail Adapter and P2-06 production-like writer, then closes the writable preparation connection before producing the manifest. The final runtime does not import or execute the Adapter, P2-06 writer, Scheduler, Collection Runtime, Canonicalizer, Requirement Parser, or Eligibility Engine. It does not read P2-04 fixtures or Raw/Snapshot artifacts.

The committed dataset contains only the verified Beijing official capture. Synthetic test records are not included. Requirement and Eligibility remain absent in the dataset, so P2-07 returns `requirements: []` and `eligibility.status: NOT_ASSESSED`; P2-08 must present those values according to the frozen acceptance rules.

This layer does not configure PostgreSQL, Supabase, a production database URL, migrations, deployment infrastructure, a Next.js route, or a Web page. P2-08 remains a separate phase.
