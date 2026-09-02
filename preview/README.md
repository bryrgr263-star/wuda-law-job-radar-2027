# Preview Persistence Exercise

P2-02 is a local/Preview-only persistence exercise. It is not a production database, Supabase migration path, storage bucket, runtime service, or a place for production data or credentials.

The PostgreSQL-oriented migration is statically validated because this repository has no local PostgreSQL client/server, Docker daemon, or in-memory PostgreSQL dependency. A separate in-memory SQLite simulation verifies equivalent clean migration, replay, foreign-key, unique, append-only, and transaction rollback behaviour; it is not PostgreSQL execution proof.

Raw bytes remain private content-addressed objects. Database rows contain only immutable RawBlob metadata and `raw/sha256/<first-two>/<sha256>` object paths. No Source Run, lifecycle, scheduler, transport, Adapter, API, or web functionality exists here. Recovery replays Preview migrations and reconciles Snapshot-to-RawBlob hashes. Retention is `RETAIN_UNTIL_REVIEWED`; deletion is tombstone-then-purge policy only, never executed here.
