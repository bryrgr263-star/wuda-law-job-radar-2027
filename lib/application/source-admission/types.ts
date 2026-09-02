import type { AuthorityLevel, ContentKind, OriginalText, TraceableText } from "../../ingestion";

declare const sourceAdmissionBrand: unique symbol;

export type SourceAdmissionId = string & {
  readonly [sourceAdmissionBrand]: "SourceAdmissionId";
};

export type SourceAdmissionEvidenceId = string & {
  readonly [sourceAdmissionBrand]: "SourceAdmissionEvidenceId";
};

export type SourceAdmissionReviewId = string & {
  readonly [sourceAdmissionBrand]: "SourceAdmissionReviewId";
};

export const SOURCE_ADMISSION_STATUSES = [
  "APPROVED",
  "REJECTED",
  "REVIEW"
] as const;

export type SourceAdmissionStatus = (typeof SOURCE_ADMISSION_STATUSES)[number];

export const SOURCE_ADMISSION_SOURCE_TYPES = [
  "OFFICIAL_CAREER_SITE",
  "OFFICIAL_RECRUITMENT_PAGE",
  "OFFICIAL_FEED",
  "OFFICIAL_DOCUMENT_PORTAL",
  "THIRD_PARTY_PLATFORM"
] as const;

export type SourceAdmissionSourceType =
  (typeof SOURCE_ADMISSION_SOURCE_TYPES)[number];

export const SOURCE_STRUCTURES = [
  "STATIC_HTML",
  "JSON",
  "RSS",
  "DOCUMENT",
  "DYNAMIC",
  "UNKNOWN"
] as const;

export type SourceStructure = (typeof SOURCE_STRUCTURES)[number];

export type SourceStability = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type SourceUpdateFrequency = "CONTINUOUS" | "DAILY" | "WEEKLY" | "IRREGULAR" | "UNKNOWN";
export type SourceAdmissionPriority = "HIGH" | "MEDIUM" | "LOW";
export type AccessReviewStatus = "ALLOWED" | "DISALLOWED" | "UNKNOWN";
export type LoginRequirement = "NONE" | "OPTIONAL" | "REQUIRED" | "UNKNOWN";
export type CaptchaPresence = "NONE_OBSERVED" | "PRESENT" | "UNKNOWN";

export const SOURCE_PROHIBITED_ACTIONS = [
  "NO_AUTHENTICATED_ACCESS",
  "NO_CAPTCHA_BYPASS",
  "NO_CREDENTIAL_USE",
  "NO_BROWSER_AUTOMATION",
  "NO_ENDPOINT_DISCOVERY",
  "NO_RATE_LIMIT_EVASION",
  "NO_UNAPPROVED_SUBPATHS"
] as const;

export type SourceProhibitedAction = (typeof SOURCE_PROHIBITED_ACTIONS)[number];

export const SOURCE_ADMISSION_EVIDENCE_KINDS = [
  "ROBOTS",
  "TERMS",
  "ENDPOINT_INSPECTION",
  "MANUAL_REVIEW",
  "OTHER"
] as const;

export type SourceAdmissionEvidenceKind =
  (typeof SOURCE_ADMISSION_EVIDENCE_KINDS)[number];

export interface SourceAdmissionEvidence {
  readonly source_admission_evidence_id: SourceAdmissionEvidenceId;
  readonly kind: SourceAdmissionEvidenceKind;
  readonly locator: string;
  readonly captured_at: string;
  readonly summary: OriginalText;
}

export interface SourceAdmissionReviewRecord {
  readonly source_admission_review_id: SourceAdmissionReviewId;
  readonly reviewer: string;
  readonly reviewed_at: string;
  readonly decision: SourceAdmissionStatus;
  readonly rationale: OriginalText;
  readonly evidence_ids: readonly SourceAdmissionEvidenceId[];
}

export interface SourceAccessReview {
  readonly status: AccessReviewStatus;
  readonly evidence_id: SourceAdmissionEvidenceId;
}

export interface SourceAdmission {
  readonly source_admission_id: SourceAdmissionId;
  readonly source_name: TraceableText;
  readonly source_type: SourceAdmissionSourceType;
  readonly official_owner: TraceableText;
  readonly endpoint: string;
  readonly content_kind: ContentKind;
  readonly source_authority: AuthorityLevel;
  readonly robots: SourceAccessReview;
  readonly terms: SourceAccessReview;
  readonly login_requirement: LoginRequirement;
  readonly captcha: CaptchaPresence;
  readonly structure: SourceStructure;
  readonly stability: SourceStability;
  readonly update_frequency: SourceUpdateFrequency;
  readonly priority: SourceAdmissionPriority;
  readonly prohibited_actions: readonly SourceProhibitedAction[];
  readonly evidence: readonly SourceAdmissionEvidence[];
  readonly review_records: readonly SourceAdmissionReviewRecord[];
  readonly admission_decision: SourceAdmissionStatus;
}

export const LIVE_CANARY_SCOPES = ["ONE_ENDPOINT_ONE_RUN"] as const;

export type LiveCanaryScope = (typeof LIVE_CANARY_SCOPES)[number];

export interface LiveCanaryManualAuthorization {
  readonly source_admission_id: SourceAdmissionId;
  readonly authorized_by: string;
  readonly authorized_at: string;
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly scope: LiveCanaryScope;
  readonly manual_confirmation: true;
}

export const LIVE_CANARY_DENIAL_CODES = [
  "NO_MANUAL_AUTHORIZATION",
  "ADMISSION_NOT_APPROVED",
  "AUTHORIZATION_TARGET_MISMATCH",
  "AUTHORIZATION_EVIDENCE_MISSING",
  "LIVE_CANARY_SCOPE_INVALID"
] as const;

export type LiveCanaryDenialCode = (typeof LIVE_CANARY_DENIAL_CODES)[number];

export type LiveCanaryAuthorizationDecision =
  | {
      readonly allowed: true;
      readonly source_admission_id: SourceAdmissionId;
      readonly authorization: LiveCanaryManualAuthorization;
    }
  | {
      readonly allowed: false;
      readonly source_admission_id: SourceAdmissionId;
      readonly reason_codes: readonly LiveCanaryDenialCode[];
    };
