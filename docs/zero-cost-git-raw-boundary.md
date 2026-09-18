# Zero-Cost Git Raw Boundary

The Git Raw boundary reuses `RawBlob`, `RawBlobManifest`,
`PrivateRawObjectStorage`, `ProductionSourceFactRepository`, `Snapshot`, and
`ExtractedRecord`. It does not define a second RawBlob identity.

## Layout

```text
trusted-objects/
├─ objects/sha256/ab/cd/<full-sha256>
├─ facts/
│  ├─ raw-blob-manifests/<identity-hash>.json
│  ├─ acquisition-runs/<identity-hash>.json
│  ├─ snapshots/<identity-hash>.json
│  └─ extracted-records/<identity-hash>.json
├─ manifests/
│  ├─ acquisitions/000000000001.json
│  └─ states/<state-manifest-hash>.json
└─ state-manifest.json
```

An acquisition append commits its Raw object, manifest, run, Snapshot, and
ExtractedRecords together. SourceOccurrence materialization is a subsequent
existing Trusted Chain execution. The Raw-validated journal adapter permits that
execution only when the committed Snapshot and ExtractedRecord match a verified
Raw object and manifest. A crash between those commits can therefore leave
verified Raw evidence not yet admitted into the Trusted Chain, but can never
create a trusted SourceOccurrence without its Raw evidence.

## Object and repository limits

- Recommended single object size: 25 MiB.
- Enforced default single object limit: 95 MiB, below GitHub's 100 MiB file limit.
- Annual archive rollover threshold: 1 GiB of unique Raw objects.
- Absolute configured repository object threshold: 2 GiB.

Crossing an enforced threshold raises `EVIDENCE_BLOCKED`. It never switches to an
external store automatically. Archive rollover requires a separately approved
repository and remains outside this phase.

## SQLite

SQLite is a disposable index. It contains canonical manifests and references but
not authoritative Raw bytes. Deleting it and rebuilding it from committed Git
state produces the same canonical index hash and deterministic database bytes.

## Privacy

This boundary is for recruitment source RawBlob and attachment evidence. It does
not accept or implement real `DOCUMENT_VERIFIED` Candidate Evidence. Sensitive
identity documents must not be committed through this adapter.
