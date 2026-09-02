# Phase 2 Application Boundaries

## P2-01 scope

P2-01 adds only `lib/application/` as a downstream application boundary and a source-admission contract. It does not add a transport, collection runner, real Adapter, database, storage bucket, API, web page, scheduler, or real network access.

## Dependency direction

```text
lib/application → lib/ingestion
```

P1 code under `lib/ingestion/` must never import `lib/application/`. The legacy production files, old `jobs` model, old source catalog, old sync path, Supabase production schema, API route, and website must not import the P2 application layer.

## Source Admission Register

The in-memory P2-01 register records a candidate source's name, type, official owner, endpoint, P1 `RecruitmentEndpoint` reference, endpoint purpose, allowed HTTP method, authority, robots and terms evidence, login/CAPTCHA conditions, structure, stability, update frequency, priority, prohibited actions, evidence, and review records. P1 remains the only Endpoint semantic source; Admission approves one referenced Endpoint's permitted use.

Admission decisions remain `APPROVED`, `REJECTED`, or `REVIEW` and are separate from the A/B/C/D admission level. Access evidence remains explicit: `UNKNOWN` is neither `ALLOWED` nor `PROHIBITED`, and the legacy `DISALLOWED` value remains a prohibited result for compatibility.

| Level | Meaning | Permission |
| --- | --- | --- |
| `A` | Explicit official automation evidence | `APPROVED` may express normal controlled collection eligibility |
| `B` | Official public source with unresolved robots or terms evidence | `REVIEW`, or `APPROVED` only for a human-reviewed `ONE_ENDPOINT_ONE_RUN` Canary |
| `C` | Restricted, conflicting, or insufficient evidence | `REVIEW`; collection denied |
| `D` | Explicit prohibition or access-control bypass requirement | `REJECTED`; collection denied |

`automation_basis` records the actual basis without upgrading uncertain evidence: `EXPLICIT_OFFICIAL_POLICY`, `ROBOTS_ALLOW`, `OFFICIAL_API`, `HUMAN_REVIEWED_CANARY`, `NO_AUTOMATION_ALLOWED`, `INSUFFICIENT_EVIDENCE`, or `CONFLICTING_EVIDENCE`. A successful B-level Canary does not change the level. Any level, decision, or basis revision requires new evidence and a new human review record.

Admission evidence binds its admission and exact Endpoint, official source URL, evidence kind and locator, observation time, reviewer, observed decision, and original-language summary. Robots and terms decisions must match their referenced evidence records.

Third-party recruitment platforms may be recorded only as `REJECTED`; they cannot be approved in Phase 2.

## Network default deny

P2-01 contains no network implementation. A Live Canary is denied unless a specific approved admission has a matching, human-authored, single-endpoint/single-run authorization with referenced admission evidence. B-level approval grants only this Canary scope and never permanent collection permission. The authorization record itself binds the authorization ID, admission ID, exact endpoint locator, P1 `RecruitmentEndpoint` ID, endpoint purpose, allowed HTTP method, one collection-run ID, reviewer, issue time, and evidence ID. Evaluation directly compares each execution field with the authorization and then verifies the admitted scope. Any source, endpoint, P1 Endpoint reference, endpoint purpose, HTTP method, run, evidence, scope, level, or approval mismatch is rejected. P2-04 admission currently permits `GET` only. The in-memory authorization gate consumes an authorization ID after its first successful evaluation, so it cannot authorize a second execution. The contract grants no execution capability; P2-04 will be the first stage permitted to supply a network-capable runner.

Formal tests continue to install the shared Network Guard. Any accidental `fetch`, HTTP, HTTPS, TCP, or TLS operation fails.

## P2-01 exclusions

- No production or Preview database and no storage bucket.
- No Source Run persistence, run result persistence, or missing streak persistence.
- No external endpoint discovery, crawling, or polling.
- No Requirement or Eligibility evaluation outside the frozen P1 engines.
