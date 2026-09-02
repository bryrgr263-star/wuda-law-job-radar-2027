# P2-08 Preview Acceptance Rules

## Scope

P2-08 is a read-only Web Preview acceptance phase. Its purpose is to validate this one-way path:

```text
Production Ingestion -> Read-only Projection -> Web Preview
```

It is not intended to look like a complete recruitment website. When data is incomplete, the Preview must report that limitation rather than infer a result.

## 1. Permitted Data Source

P2-08 may read only the P2-07 read-only ingestion projection/API. It must not read directly from:

- Raw captures or Snapshots;
- Adapters, the Scheduler, or the Collection Runtime;
- Preview Persistence;
- legacy jobs/sync paths, including `app/api/jobs` and the crawler;
- third-party recruitment platforms; or
- legacy Supabase business paths.

The UI must not trigger Collection, Scheduler dispatch, HTTP requests, Canonicalization, Requirement calculation, or Eligibility calculation.

## 2. Requirement Presentation

### Observed Requirements

A requirement may be shown as a job requirement only when a persisted `RequirementFact` has persisted `RequirementEvidence`. The displayed requirement must remain traceable through Requirement, Evidence, Snapshot, Raw, and the official `original_url`.

### Incomplete or Unobserved Requirements

When the captured announcement content does not provide enough evidence for complete job requirements, the UI must display **"未观察到完整岗位要求"** or equivalent unambiguous language.

The UI must never display or infer any of the following solely because `requirements: []` is returned:

- "无岗位要求";
- "不限专业";
- "无学历要求"; or
- "没有资格限制".

An empty requirements array is not evidence that no requirement exists.

## 3. Eligibility Presentation

When no persisted `EligibilityAssessment` exists, the UI must display **"未评估"** (`NOT_ASSESSED`).

The UI must not:

- calculate eligibility itself;
- decide eligibility from an empty requirements array;
- infer suitability for 法律硕士（非法学） from a title or major name;
- perform front-end major matching; or
- use AI/LLM output to fill missing conditions.

## 4. Official Provenance

Every displayed opportunity must be traceable through the P2-07 projection to:

- Source;
- RecruitmentEndpoint;
- SourceOccurrence;
- ExtractedRecord;
- Snapshot;
- Raw;
- Collection Run; and
- the official `original_url`.

The original-announcement link must point to that official `original_url`. The Preview must not show URLs from 智联招聘, BOSS直聘, 前程无忧, 猎聘, or any other third-party recruitment platform.

## 5. Data Range

P2-08 may display only records already written to isolated production ingestion.

The currently validated Beijing official public-institution data is permitted. P2-06 synthetic data is permitted only in automated tests and must never be presented as real recruitment data.

## 6. Attachment Boundary

P2-04D established that some official announcements keep complete job tables in attachments. P2-08 therefore must not:

- claim attachment-backed announcements have complete job requirements;
- access or parse attachments;
- infer job conditions from an attachment link; or
- issue an Eligibility conclusion from attachment content that has not been captured and evidenced.

P2-04E, or formally equivalent attachment admission, controlled capture, and parsing capability, remains a future independent phase. It is not a P2-08 start blocker, but it is required before any complete-condition display or attachment-based Eligibility conclusion.

## 7. Read-only Product Boundary

P2-08 Preview must not add login, registration, favorites, applications, recommendations, user systems, payments, AI interview features, resume generation, notifications, administration, manual opportunity edits, manual Eligibility edits, automated collection, or automated scheduling.

## 8. Acceptance Principle

P2-08 accepts only a correct read-only projection path. It must demonstrate this principle:

> 数据不完整时，系统宁可明确告诉用户“未观察到完整岗位要求 / 未评估”，也绝不能猜测。

## Current Conclusion

`P2-08 ACCEPTANCE RULES FROZEN`

`P2-08 READY WITH PRECONDITIONS`

P2-04E is not a P2-08 start blocker. Any display claiming complete job conditions, or any Eligibility assessment based on attachment content, must wait for P2-04E or equivalent formally admitted attachment capture and parsing capability.
