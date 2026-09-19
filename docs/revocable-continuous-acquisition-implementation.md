# Revocable Continuous Unattended Acquisition

## Scope and ownership

This implements the approved continuous authorization boundary, not a scheduler,
deployment, source expansion, or permission to contact a real recruitment URL.
No Zhenghan or Haier production continuous grant is issued by this implementation.

`InMemorySourceAdmissionRegister` remains the sole Admission authority. Its command
methods derive immutable record proposals; successful authoritative publication
and validated restoration establish the committed state. The persistence ledger
is not a second registry. The existing production composition root coordinates
issuance, revocation, explicit recovery, and each acquisition attempt.

## Current implementation inventory

| Frozen requirement | Code status | Boundary |
| --- | --- | --- |
| Authorization issuance | IMPLEMENTED | Existing Admission owner; explicit reviewed continuous scope |
| Semantic identity/version | IMPLEMENTED | Stable stream ID, payload hash and seal; actor/time reuse returns original record |
| Approval evidence | IMPLEMENTED | Exact reviewed Admission and evidence IDs/hashes |
| Exact target binding | IMPLEMENTED | Existing P1 Endpoint plus exact allowlist entry and canonical HTTPS URL |
| Network policy | IMPLEMENTED | GET only; no query/body/user headers, redirects, session or interactive fallback |
| Revocation | IMPLEMENTED | Append-only terminal event; no version fallback or automatic reactivation |
| Per-request authorization | IMPLEMENTED | Fresh committed state, current bindings and authoritative remote head per attempt |
| Cadence accounting | IMPLEMENTED | Exact URL plus method; confirmed failures count; completion/recovery anchors cooldown |
| CAS/fencing | IMPLEMENTED | Expected-parent publication before dispatch; explicit externally verified recovery |
| Attempt reservation | IMPLEMENTED | Committed exclusive pending gate; retries re-enter the same boundary |
| Attempt completion | IMPLEMENTED | Matching holder and attempt; separately committed accounting |
| Pending/crash state | IMPLEMENTED | Before-send and unknown-send both fail closed without timeout takeover |
| Recovery | IMPLEMENTED | Trusted root configuration must verify fencing evidence; default DENY |
| Git persistence | IMPLEMENTED | Existing source-state namespace, immutable records and hash-linked manifest history |
| Process B restoration | IMPLEMENTED | Existing Source owners replay; canonical proposal reconstruction, not JSON trust |
| Production root wiring | IMPLEMENTED | Continuous run accepts authorization IDs and committed Source state only |
| Architecture guards | IMPLEMENTED | Runtime import closure checks for the authorization boundary |

Controlled authorization, HTTP responses, fencing proofs and local Git remotes in
tests are TEST_ONLY. Actual production governance, verified worker fencing and
remote administration remain operator/deployment responsibilities.

## Records and restoration

`continuous-admission-record/1.0.0` records have a global sequence, previous hash,
stable event identity, canonical payload and integrity hash. GRANT contains the
authorization version, Source/Admission/Endpoint/target revisions and hashes,
policy, effective time, approval evidence and original issuance envelope.
REVOKE, RESERVE, COMPLETE and RECOVER are immutable append-only events.

The existing `git-source-registry-state/1.0.0` manifest has an optional
`continuous_records` extension. Historical manifests without this extension
retain their original bytes and hashes. Records live under
`production-source-state/continuous/records`; immutable manifest snapshots remain
under `production-source-state/state/history`.

Process B loads committed bytes, validates canonical encoding, manifest/hash
references, append-only prefix history and Source revision chains. It replays
records through the same Admission processors, validating seals, evidence,
upstream bindings, version/sequence, revocation, cadence and holder/fencing rules.
Only then does the Admission owner install the validated record history.

## Request and crash ordering

Each request is defensively cloned at entry. Caller mutation during publication
cannot change the target or headers that were validated. Every retry independently
resolves the latest authorization and current Source bindings. Permission.allowed
and historical one-shot manual approvals are not continuous request authority.

The root publishes RESERVE with an exact expected parent through a normal
fast-forward Git push, confirms the authoritative head, and only then dispatches.
Stale clones and losing writers send zero HTTP. While pending, all new issuance,
revocation, Source revision and attempt mutations are excluded; immutable reuse
is a no-op. A revocation committed before reservation denies dispatch. An already
reserved/in-flight request is ordered before any successful revocation.

A thrown transport error, uncertain publication, crash, or completion failure
leaves the committed reservation pending. There is no timeout takeover. Recovery
requires a root-owned `ContinuousFencingVerifier` proving the old worker cannot
continue. Recovery records FENCED_UNKNOWN rather than guessing whether HTTP was
sent, and conservatively starts a new cooldown at verified recovery time.
Rehydration re-verifies fencing evidence; a missing verifier fails closed.

The root clock is trusted configuration, not a run input or response timestamp.
Noncanonical UTC times, rollback and cadence violations deny attempts. This is
not a distributed clock system or a guarantee against an administrator supplying
an incorrect clock.

## Production configuration and limitations

The production root defaults to PRODUCTION scope. A controlled transport is
accepted only with CONTROLLED_TEST scope. Continuous run `source_versions` must
be empty; the root uses committed versions and requires authorization IDs. Source
contract changes cause REAUTHORIZE_REQUIRED rather than automatic rebinding.

Operators must separately approve exact official targets and continuous Admission
scope, configure a trustworthy clock and fencing verifier when recovery is needed,
and protect the authoritative Git branch and credentials against force pushes,
deletion and bypass writers. Hashes establish consistency, not reviewer identity
or hardware immutability; a privileged Git administrator can rewrite history.
No real production grant, scheduler, workflow, deployment or network operation is
performed here. Existing Presentation and historical recruitment evidence are
unchanged by revocation. No database is an authorization authority.

## Verification provenance

The previous 21/21 run did not cover the later edits to
`tests/production-persistence/continuous-gate.test.ts`: Source binding revision,
same-parent concurrent writers and expanded independent Process B pending,
recovery and revocation checks. That result is not final acceptance.

Final closure additionally tests request mutation, binding substitution, effective
time/clock safety, corrupt committed restoration and the retry gate. The request
mutation regression was observed failing before the defensive-clone fix. Final
verification results and the implementation commit are reported separately after
the complete regression ladder and full offline suite finish.
