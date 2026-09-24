# Initial production source activation

The first production source set contains exactly two previously verified official sources: Zhenghan (two exact pages) and Haier (one exact page). The official HTML adapter implementations are owned by `lib/production-sources/`; historical Canary imports are compatibility re-exports, never dependencies of production code. Scheduler adapter resolution uses the single production registry.

The committed `production-source-state/` ledger contains source and endpoint revision 1, Level B Canary admission revision 1, reviewed continuous admission revision 2, allowlist revisions 1 and 2, and three separately sealed grants. The revision 2 allowlists bind the current admission artifact and its endpoint purpose. No source identity or semantic source revision was duplicated. Continuous authority is `PRODUCTION` scope, exact GET only, with a minimum interval of 86,400 seconds per target. A workflow trigger does not waive that interval or the request gate.

`scripts/stage-initial-production-sources.ts --offline-stage` is a one-time reproducibility tool gated to the approved base commit. It builds and verifies the same ledger through the existing Git registry and root in a temporary local bare repository, then stages the generated ledger in the workspace. It makes no external network request and never pushes to the project remote. The committed ledger, not the tool process, is authoritative. Process B replays the ledger and grants; revocation is an append-only `REVOKE` record, not removal of a registry key.

Source activation is distinct from GitHub Actions enablement and real-source acquisition. This stage does not run remote Actions, access the official sites, or publish a Web change.
