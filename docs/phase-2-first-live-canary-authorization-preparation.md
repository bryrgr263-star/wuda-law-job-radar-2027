# P2-04 First Live Canary Authorization Preparation

## Scope

This preparation is offline only. It does not create a `LiveCanaryManualAuthorization`, a
Collection Run, an enabled P1 `RecruitmentEndpoint`, or any network capability.

## Candidate

- Source: 北京市人民政府事业单位招聘
- Admission: `B + REVIEW`
- Robots: `ALLOWED`
- Terms: `UNKNOWN`
- Endpoint: `https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/`
- Purpose: `JOB_LIST`
- Method: `GET`
- Scope: `ONE_ENDPOINT_ONE_RUN`

The candidate remains non-executable. A later evidence-backed human review must explicitly
approve the Level B Canary under the frozen P2-01 rules before an authorization can be signed.

## Pending Human Inputs

- `authorization_id`
- `collection_run_id`
- `reviewer`
- `issued_at`
- `evidence_id`
- `manual_confirmation = true`

Until these values are supplied by an actual human approval, they remain
`PENDING_HUMAN_APPROVAL` and no executable authorization object may be materialized.

## Adapter Boundary

`cn-cas-ntsc-official-html` remains the NTSC-only offline Adapter and is not assigned to the
Beijing endpoint. 北京来源需要单独的官方 HTML Adapter / selector confirmation，待真实 Canary 后处理。

The current preparation therefore keeps the Beijing P1 `RecruitmentEndpoint` instance disabled
and pending. It does not guess selectors, issue HTTP requests, or alter P1, P2-01, P2-02, or
P2-03.
