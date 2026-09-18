# Zero-Cost Git Persistence Layout

`GitAppendOnlyExecutionStore` is an infrastructure adapter for the existing
`TrustedRestorationJournalRepository`. It does not create a second Trusted Chain.

## Canonical layout

```text
trusted-state/
├─ journal/
│  ├─ segments/000000000001.json
│  └─ head.json
├─ artifacts/
│  ├─ objects/<envelope-integrity-hash>.json
│  └─ identities/<kind-and-kind-hash>/<identity-hash>.json
├─ read-model/
│  ├─ objects/<artifact-hash>.json
│  └─ identities/<identity-hash>.json
├─ manifests/
│  ├─ executions/000000000001.json
│  └─ states/<state-manifest-integrity-hash>.json
└─ state-manifest.json
```

Every file uses the existing canonical serialization. Immutable journal segments,
artifact objects, identity records, execution manifests, and state snapshots are
never overwritten. `journal/head.json` and `state-manifest.json` are moving
pointers whose prior bytes remain recoverable from Git history and immutable state
snapshots.

## Commit boundary

One `appendExecution` produces one Git commit. Files are generated and validated
in a temporary workspace before being copied into the repository and committed.
Process B reads committed bytes from `HEAD`, never uncommitted working-tree bytes.

The `state_commit` field in `journal/head.json` records the expected parent commit.
The commit containing the head cannot embed its own Git commit hash without a
self-reference. Its actual authoritative commit is therefore the checkout commit
from which the file is read.

With a remote configured, the adapter verifies the remote branch against the
expected parent and uses a normal fast-forward push. It never force-pushes,
automatically merges, or rebases authoritative state. A changed remote head causes
an abort and requires a fresh checkout, rehydration, and rerun.

## Deferred trust anchor

`checkpoint_reference` remains `null` in Phase 1. Git history is not an external
non-forgeable trust anchor. Signed external checkpoints remain deferred and this
adapter must not be represented as providing that guarantee.
