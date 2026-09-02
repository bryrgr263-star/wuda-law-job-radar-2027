# P2-07 Read-only API & Query Projection

The P2-07 API is an in-process, framework-neutral `GET` handler over a caller-supplied `ingestion_production` database connection. It does not configure a database client, deploy a database schema, start an HTTP server, or add a Next.js route. Binding the handler to a real production database or server remains separately authorized work.

Supported endpoint contracts are:

- `GET /api/ingestion/v1/opportunities?keyword=&organization=&source=&observation_state=&offset=&limit=`
- `GET /api/ingestion/v1/opportunities/{opportunity_id}`
- `GET /api/ingestion/v1/sources`
- `GET /api/ingestion/v1/source-health`

All responses project existing `ingestion_*` rows only. The API never writes, canonicalizes, parses Requirements, assesses Eligibility, dispatches a scheduler, invokes an Adapter, or makes HTTP requests. `SourceHealth` is an immutable caller-supplied P2-05 snapshot and must match a persisted Source Admission plus RecruitmentEndpoint binding; P2-07 does not read or mutate scheduler memory.

Requirement facts are returned only when they have persisted Evidence. Every Requirement Evidence response includes its Snapshot, Raw Blob, and original official URL. Eligibility is returned only as a persisted assessment; otherwise the API returns `NOT_ASSESSED` and a persisted deferral reason when available. Observation state is a direct projection of the persisted Collection Run status and never infers `CLOSED` or `EXPIRED`.
