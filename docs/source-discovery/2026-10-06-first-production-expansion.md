# First production source expansion — reviewed scope

Only National Energy Group's two individually reviewed 2027 campus positions are selected. Other search results are not admitted. Capability A/C, legacy, business rules, Scheduler cadence and Pages implementation are unchanged.

## Official batch binding

The official announcement at `https://zhaopin.chnenergy.com.cn/annc/showgg?id=6a152f40-7fe5-460e-ad37-0024acafd8c9` identifies the 2027 graduate recruitment batch and links its own vacancy list. Its form retains that exact announcement ID. Public GET with the observed form's `zhaopingangwei` field returns these exact members:

| Employer | Position | Official job ID | Official membership filter |
| --- | --- | --- | --- |
| 中国神华煤制油化工有限公司鄂尔多斯煤制油分公司本部 | 法务管理 | `5a798bfe-a4d6-0be4-e063-98b4d40a088a` | 法务管理 |
| 国能西部能源青松新疆矿业有限公司 | 合规管理岗 | `5a798bfe-ac8c-0be4-e063-98b4d40a088a` | 合规管理岗 |

The member-list URLs are retained in the adapter's reviewed configuration and immutable Source Admission evidence. Both detail pages independently expose the same recruitment project `e929662a-324a-47d0-b4ca-9fe5ef47b8ba` in their public application entry. The adapter requires the selected job ID, exact employer/title and project tuple to match. A changed/missing binding fails closed. Year 2027 is derived from this reviewed official campaign membership, never from publication date or candidate information.

Read-only inspection returned HTTP 200 HTML without redirect or credential use. The pages contain a site-wide login form, but public job content is readable anonymously; login is not used. Two `myToken` hidden inputs were observed empty. Cookie values, form secrets, credentials and login requests are not retained by this review. The production transport remains stateless and unchanged. Robots/terms remain UNKNOWN under the existing human-reviewed Level B contract, not invented as ALLOWED.

## Minimal production admission

One official group SourceDefinition, two exact JOB_DETAIL endpoints, two independent finite-query contracts (`id` only, one approved value per endpoint), two independent revocable grants, minimum interval 86400 seconds, one request per endpoint and no pagination or discovered-link execution. Reviewed membership and announcement URLs are provenance references, not unattended acquisition targets.

Position requirements come only from the explicit 岗位要求 section. 岗位职责 is retained as job content and is not turned into candidate qualifications. All original requirement lines are retained, including unsupported or ambiguous conditions. Existing production composition, relevance, requirements, eligibility, presentation and current selection are used unchanged; EVIDENCE_BLOCKED is a valid retained outcome.

The official public job URL is both the announcement/detail entry and the page containing the Apply button. Application authentication itself is outside acquisition scope. No guessed application action/API is linked or executed.

## Huadian

`https://m.chd.com.cn/site/2mobile/2026-09-14/bfb1ebce929344738977d8978213a933.html` establishes official 2027 recruitment and law-major demand, but not a bound individual employer/Position. Attachment and unit-specific conditions remain unresolved. No Huadian position or production grant is invented; this does not block National Energy Group.

## Operations

`scripts/activate-chnenergy-first-expansion.ts` is a source-specific operator entry, not a second crawler or Scheduler. It requires a clean exact local/remote expected SHA and no unresolved RESERVE. Source versions are staged without network requests. Grant issuance and each individual real acquisition use the existing production root; the caller cannot supply a replacement executor or transport. Source activation, acquisition and public publication are separate auditable operations, and only publication can be retried without acquisition.

Status at design/implementation checkpoint: offline tests underway; no production grant or production acquisition executed yet. Website growth must be measured after authoritative persistence and public deployment, not from research-visible vacancies.
