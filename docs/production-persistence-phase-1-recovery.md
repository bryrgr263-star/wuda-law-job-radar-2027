# Production Persistence Phase 1 Recovery

Status: `PHASE 3 FOUNDATION IMPLEMENTED / NO PRODUCTION DEPLOYMENT`

The migrations under `production/persistence/migrations` are forward-only after
the first production write. They do not include destructive down migrations.

## Pre-production rollback

An empty staging project may be discarded and recreated. Do not run ad-hoc
`DROP`, `UPDATE`, `DELETE`, or `TRUNCATE` against an initialized Trusted Chain
schema.

## Production recovery

1. Stop all writers and revoke their login-role memberships.
2. Preserve the database backup, private Storage objects, and deployment logs.
3. Restore PostgreSQL and `trusted-raw-production` into an isolated project.
4. Reset credentials for custom login roles and re-grant only the frozen group
   roles.
5. Verify every RawBlob manifest against the private object bytes and SHA-256.
6. Verify Source Registry revision continuity, supersedes links, canonical bytes,
   provenance, and integrity hashes.
7. Verify the signed genesis/checkpoint chain, normalized journal seals, Artifact
   Ledger envelopes/upstreams, and hash-chain tail before calling
   `bootstrapTrustedChainCompositionRoot()` in Process B.
8. Keep the API disabled until replayed PresentationReadModel seals match the
   persisted read projection.

Migrations 004-005 and the PostgreSQL-backed Process B loader now implement the
offline `appendExecution`, Artifact Ledger, Journal Head, checkpoint contract, and
command-journal recovery foundation. This remains an un-deployed SQL contract:
real Supabase execution and real KMS checkpoint signing are not implemented or
verified. Candidate Evidence issuance and the PostgreSQL Presentation reader are
implemented contracts, but no real user evidence or production database was used.
