# Phase 2 Application Boundaries

## P2-01 scope

P2-01 adds only `lib/application/` as a downstream application boundary and a source-admission contract. It does not add a transport, collection runner, real Adapter, database, storage bucket, API, web page, scheduler, or real network access.

## Dependency direction

```text
lib/application → lib/ingestion
```

P1 code under `lib/ingestion/` must never import `lib/application/`. The legacy production files, old `jobs` model, old source catalog, old sync path, Supabase production schema, API route, and website must not import the P2 application layer.

## Source Admission Register

The in-memory P2-01 register records a candidate source's name, type, official owner, endpoint, authority, robots and terms evidence, login/CAPTCHA conditions, structure, stability, update frequency, priority, prohibited actions, evidence, and review records.

Admission decisions are `APPROVED`, `REJECTED`, or `REVIEW`. Only an `APPROVED` official or authorized source with allowed robots and terms, no login or CAPTCHA requirement, the complete prohibited-action set, and an approved review record can become eligible for a later Live Canary.

Third-party recruitment platforms may be recorded only as `REJECTED`; they cannot be approved in Phase 2.

## Network default deny

P2-01 contains no network implementation. A Live Canary is denied unless a specific approved admission has a matching, human-authored, single-endpoint/single-run authorization with referenced admission evidence. The contract grants no execution capability; P2-04 will be the first stage permitted to supply a network-capable runner.

Formal tests continue to install the shared Network Guard. Any accidental `fetch`, HTTP, HTTPS, TCP, or TLS operation fails.

## P2-01 exclusions

- No production or Preview database and no storage bucket.
- No Source Run persistence, run result persistence, or missing streak persistence.
- No external endpoint discovery, crawling, or polling.
- No Requirement or Eligibility evaluation outside the frozen P1 engines.
