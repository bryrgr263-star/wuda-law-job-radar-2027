# Web / JobBoard cutover preparation

This is an opt-in preparation boundary, not a production cutover or a new website.

## Entries

- Unset `PRESENTATION_WEB_PREPARATION`: the existing page loads the frozen legacy UI and `lib/jobs.ts`. No Legacy database or workflow is retired here.
- Exact `PRESENTATION_WEB_PREPARATION=ENABLED`: the same page loads `components/job-board.tsx`, using the independent Presentation display model. The old component is preserved as `components/legacy-job-board.tsx` for the default path, not deployed as a second website.
- The existing `/api/presentation/v1` route selects the Git reader only in preparation mode; its previous PostgreSQL path remains unchanged otherwise. No additional API is introduced.

The preparation reader uses the existing `GitAppendOnlyExecutionStore.readCurrentSnapshot()` and `ReadOnlyPresentationApi`. One verified snapshot is anchored per read. Pagination, public status selection, Position-scoped current revision selection and integrity checks remain owned by those existing components. The mapper never selects revisions or reevaluates business outcomes. Refresh reloads the page and reads the latest committed current snapshot; it does not acquire source data.

The runtime requires a local Git checkout including `.git`, committed `trusted-state`, Git executable and the production stream (`PRODUCTION_STREAM_ID`, default `initial-production-source-activation`). A repositoryless deployment or static mirror is not made production-ready by this phase. On long Windows checkout paths, Git requires `core.longpaths=true`; verification can supply this through process-local Git configuration without changing repository configuration. Reader failure never falls back to Legacy or demo data in new mode; the API returns 503.

## Display mapping

`position_id` is the card identity. Employer, title, locations, recruitment year/batch, requirement summary, announcement/application links and update time are copied from the current sealed ReadModel. Missing fields display `尚未取得`. No unit type, salary, deadline, eligibility, relevance result or personal matching score is inferred. The existing CSS, page layout, card/detail presentation, search and CSV export are reused. Status/employer filters and update/name sorting operate only on display fields.

`DISPLAY`, `DISPLAY_WITH_REVIEW`, `EVIDENCE_BLOCKED` are public. Blocked evidence is displayed as `证据待完善`, not a negative qualification conclusion. Reason codes and decision/model identifiers are detail-only provenance. Unsafe link schemes are not made clickable. Announcement links never substitute for missing application links. CSV text is quoted and formula-prefixed values are escaped.

## Historical evidence

The four committed Run 1 models retain `EVIDENCE_BLOCKED` and `RELEVANCE_ASSESSMENT_MISSING`. Three Zhenghan application links and all four requirement summaries are unavailable. The temporary downstream revision-2 fork is not used. There are no hardcoded Run 1 exceptions or frozen revision IDs in the Web reader. Future committed current revisions naturally flow through the existing repository/API boundary.

## Application status

`PositionApplicationStatePort` reserves a read interface keyed by stable Position ID. No implementation, UI claim, personal storage or old `applications -> jobs` relationship is added. Close this separately after Run 2 and final cutover.

## Acceptance

Offline tests use the existing committed Run 1 current models, not another real-source fixture. They cover four unique cards, truthful blocked-state/detail provenance, separated links, missing fields, query/status/employer filters, deterministic sorting, CSV export, the actual preparation page and the existing API route under Network Guard. API and architecture regressions, TypeScript, build and diff checks are required. No real acquisition, schedule, remote Actions, Legacy cleanup or final deployment occurs.

Final cutover still requires Run 2 review, deployment selection/provision of the committed Git read boundary, explicit activation approval, and separate closure of user application-state persistence.

## Local verification

Web focused 7/7; architecture 14/14; Network Guard 2/2; existing Presentation API 1/1 (combined 24/24). TypeScript, opt-in preparation build under Network Guard, and `git diff --check` passed. No full business-chain regression was rerun for this Web-only change. Frozen Legacy UI was compared with the previous version: identical except its isolated export name. Trusted business code, committed Run 1 state, source authorizations, workflows, database schema and Legacy business modules were unchanged. No new regression was observed in this phase's required verification scope; no deployment or push was performed.
