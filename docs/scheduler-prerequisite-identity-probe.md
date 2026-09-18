# Scheduler prerequisite identity probe

The approved prerequisite hardening must stop if repeated discovery can create duplicate current presentation rows. This probe precedes scheduler implementation.

1. Reuse the existing synthetic presentation fixture and authoritative processors; register two discovery observations for the same trusted source tuple and Position/PBOV.
2. Materialize both sealed decisions through the existing materializer, persist through the existing test-only SQLite repository, and read through the existing read-only API.
3. Record whether the current read collection contains one or two rows for the same Position/PBOV. This is a diagnostic, not the real-source same-Git-repository two-run acceptance test.
4. If two rows are returned, report `DUPLICATE PRESENTATION BLOCKER` and stop. Do not modify Recall, presentation identity, API filtering, or UI to hide the issue.
5. Run the presentation tests, TypeScript, P1, architecture, Network Guard, and diff checks. Audit tracked availability locally without contacting a remote or activating Actions.

Synthetic provenance remains test-only. SQLite remains a test/derived persistence boundary, not authoritative production storage. No real source is acquired by this probe.

## Observed result

The diagnostic reproduced two distinct retained Candidate IDs, two revision-1 sealed Decision IDs, and two ReadModel IDs for the same source tuple, Position, PositionVersion, and PBOV. The existing current-model repository and read-only API returned both DISPLAY rows with SYNTHETIC_TEST provenance.

`DUPLICATE PRESENTATION BLOCKER` is therefore confirmed at the processor/read-model/API boundary. The diagnostic intentionally asserts the observed duplicate behavior; its passing result is not a passing one-row acceptance gate. The real-source fixed-Git-repository Run A/Run B test has not been executed.

The cause is candidate-scoped Decision revision/idempotency and candidate-scoped current-model selection. Git-root restoration also collects models from run manifests without establishing a canonical current presentation identity across discovery events. Do not change this frozen contract or add API/UI deduplication without an approved identity-boundary fix.

Local HEAD does not track the production-persistence modules, presentation API, presentation Decision/ReadModel processors, or real-source canary modules examined. Remote fresh-clone executability remains NOT VERIFIED; no remote was contacted. Continuous authorization implementation, semantic source-revision reuse, candidate evidence reuse during unattended acquisition, and scheduler incremental orchestration were not implemented after this stop condition.
