import type {
  AuthorityLevel,
  ContentKind,
  HttpRequestMethod,
  OriginalText,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  TraceableText
} from "../../ingestion";

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

export type LiveCanaryAuthorizationId = string & {
  readonly [sourceAdmissionBrand]: "LiveCanaryAuthorizationId";
};

export type LiveCanaryCollectionRunId = string & {
  readonly [sourceAdmissionBrand]: "LiveCanaryCollectionRunId";
};

export const SOURCE_ADMISSION_STATUSES = [
  "APPROVED",
  "REJECTED",
  "REVIEW"
] as const;

export type SourceAdmissionStatus = (typeof SOURCE_ADMISSION_STATUSES)[number];

export const SOURCE_ADMISSION_LEVELS = ["A", "B", "C", "D"] as const;

export type SourceAdmissionLevel = (typeof SOURCE_ADMISSION_LEVELS)[number];

export const SOURCE_AUTOMATION_BASES = [
  "EXPLICIT_OFFICIAL_POLICY",
  "ROBOTS_ALLOW",
  "OFFICIAL_API",
  "HUMAN_REVIEWED_CANARY",
  "NO_AUTOMATION_ALLOWED",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE"
] as const;

export type SourceAutomationBasis = (typeof SOURCE_AUTOMATION_BASES)[number];

export const SOURCE_ADMISSION_ENDPOINT_PURPOSES = [
  "JOB_LIST",
  "JOB_DETAIL",
  "RECRUITMENT_NOTICE"
] as const;

export type SourceAdmissionEndpointPurpose =
  (typeof SOURCE_ADMISSION_ENDPOINT_PURPOSES)[number];

export type SourceAdmissionAllowedHttpMethod = "GET";

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
export type AccessReviewStatus =
  | "ALLOWED"
  | "DISALLOWED"
  | "PROHIBITED"
  | "UNKNOWN";
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
  readonly source_admission_id: SourceAdmissionId;
  readonly endpoint: string;
  readonly source_url: string;
  readonly kind: SourceAdmissionEvidenceKind;
  readonly locator: string;
  readonly captured_at: string;
  readonly reviewer: string;
  readonly decision: AccessReviewStatus;
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
  readonly admission_level: SourceAdmissionLevel;
  readonly automation_basis: SourceAutomationBasis;
  readonly source_name: TraceableText;
  readonly source_type: SourceAdmissionSourceType;
  readonly official_owner: TraceableText;
  readonly endpoint: string;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly endpoint_purpose: SourceAdmissionEndpointPurpose;
  readonly allowed_http_method: SourceAdmissionAllowedHttpMethod;
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

export type SourceAutomationPermission =
  | {
      readonly allowed: true;
      readonly admission_level: "A";
      readonly mode: "CONTROLLED_COLLECTION";
    }
  | {
      readonly allowed: true;
      readonly admission_level: "B";
      readonly mode: "ONE_ENDPOINT_ONE_RUN";
      readonly requires_manual_authorization: true;
    }
  | {
      readonly allowed: false;
      readonly admission_level: SourceAdmissionLevel;
      readonly mode: "DENIED";
    };

export const LIVE_CANARY_SCOPES = ["ONE_ENDPOINT_ONE_RUN"] as const;

export type LiveCanaryScope = (typeof LIVE_CANARY_SCOPES)[number];

export interface LiveCanaryManualAuthorization {
  readonly authorization_id: LiveCanaryAuthorizationId;
  readonly source_admission_id: SourceAdmissionId;
  readonly endpoint: string;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly endpoint_purpose: SourceAdmissionEndpointPurpose;
  readonly allowed_http_method: SourceAdmissionAllowedHttpMethod;
  readonly collection_run_id: LiveCanaryCollectionRunId;
  readonly reviewer: string;
  readonly issued_at: string;
  readonly evidence_id: SourceAdmissionEvidenceId;
  readonly scope: LiveCanaryScope;
  readonly manual_confirmation: true;
}

export interface LiveCanaryExecutionRequest {
  readonly source_admission_id: SourceAdmissionId;
  readonly endpoint: string;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly recruitment_endpoint: RecruitmentEndpoint;
  readonly endpoint_purpose: SourceAdmissionEndpointPurpose;
  readonly allowed_http_method: HttpRequestMethod;
  readonly collection_run_id: LiveCanaryCollectionRunId;
}

export const LIVE_CANARY_DENIAL_CODES = [
  "NO_MANUAL_AUTHORIZATION",
  "ADMISSION_NOT_APPROVED",
  "ADMISSION_LEVEL_DENIED",
  "AUTHORIZATION_SOURCE_MISMATCH",
  "AUTHORIZATION_ENDPOINT_MISMATCH",
  "AUTHORIZATION_ENDPOINT_REFERENCE_MISMATCH",
  "AUTHORIZATION_ENDPOINT_PURPOSE_MISMATCH",
  "AUTHORIZATION_HTTP_METHOD_MISMATCH",
  "AUTHORIZATION_RUN_MISMATCH",
  "AUTHORIZATION_EVIDENCE_MISSING",
  "LIVE_CANARY_SCOPE_INVALID",
  "AUTHORIZATION_BINDING_INVALID",
  "AUTHORIZATION_ALREADY_USED"
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
