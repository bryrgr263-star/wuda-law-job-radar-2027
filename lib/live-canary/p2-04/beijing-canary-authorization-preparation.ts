import type {
  LiveCanaryExecutionRequest,
  LiveCanaryManualAuthorization,
  SourceAdmission
} from "../../application";
import type { RecruitmentEndpoint } from "../../ingestion";

export const PENDING_HUMAN_APPROVAL = "PENDING_HUMAN_APPROVAL" as const;

export const BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID =
  "admission-beijing-public-institution" as SourceAdmission["source_admission_id"];
export const BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-beijing-government-public-institution-job-list-html" as RecruitmentEndpoint["recruitment_endpoint_id"];
export const BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/";

const authorizationBinding = {
  source_admission_id: BEIJING_PUBLIC_INSTITUTION_SOURCE_ADMISSION_ID,
  endpoint: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
  recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
  endpoint_purpose: "JOB_LIST",
  allowed_http_method: "GET",
  scope: "ONE_ENDPOINT_ONE_RUN"
} as const satisfies Pick<
  LiveCanaryManualAuthorization,
  | "source_admission_id"
  | "endpoint"
  | "recruitment_endpoint_id"
  | "endpoint_purpose"
  | "allowed_http_method"
  | "scope"
>;

const executionBinding = {
  source_admission_id: authorizationBinding.source_admission_id,
  endpoint: authorizationBinding.endpoint,
  recruitment_endpoint_id: authorizationBinding.recruitment_endpoint_id,
  endpoint_purpose: authorizationBinding.endpoint_purpose,
  allowed_http_method: authorizationBinding.allowed_http_method
} as const satisfies Pick<
  LiveCanaryExecutionRequest,
  | "source_admission_id"
  | "endpoint"
  | "recruitment_endpoint_id"
  | "endpoint_purpose"
  | "allowed_http_method"
>;

export const BEIJING_CANARY_AUTHORIZATION_PREPARATION = {
  source: {
    source_name: "北京市人民政府事业单位招聘",
    admission_level: "B",
    admission_decision: "REVIEW",
    robots: "ALLOWED",
    terms: "UNKNOWN",
    login_requirement: "NONE_OBSERVED",
    captcha: "NONE_OBSERVED"
  },
  authorization: {
    ...authorizationBinding,
    authorization_id: null,
    collection_run_id: null,
    reviewer: null,
    issued_at: null,
    evidence_id: null,
    manual_confirmation: false,
    approval_status: PENDING_HUMAN_APPROVAL
  },
  execution: {
    ...executionBinding,
    collection_run_id: null,
    recruitment_endpoint: null,
    execution_status: PENDING_HUMAN_APPROVAL
  },
  adapter: {
    existing_adapter_key: "cn-cas-ntsc-official-html",
    usable_for_beijing: false,
    required_action:
      "北京来源需要单独的官方 HTML Adapter / selector confirmation，待真实 Canary 后处理。"
  }
} as const;

export const BEIJING_CANARY_PREPARATION_BLOCKERS = [
  "ADMISSION_REMAINS_REVIEW",
  "HUMAN_APPROVAL_PENDING",
  "AUTHORIZATION_ID_PENDING",
  "COLLECTION_RUN_ID_PENDING",
  "REVIEWER_PENDING",
  "ISSUED_AT_PENDING",
  "EVIDENCE_ID_PENDING",
  "BEIJING_RECRUITMENT_ENDPOINT_INSTANCE_PENDING",
  "BEIJING_ADAPTER_SELECTOR_CONFIRMATION_PENDING"
] as const;

export function inspectBeijingCanaryAuthorizationPreparation() {
  const preparation = BEIJING_CANARY_AUTHORIZATION_PREPARATION;
  const bindingComplete = preparation.authorization.source_admission_id.length > 0
    && preparation.authorization.endpoint === preparation.execution.endpoint
    && preparation.authorization.recruitment_endpoint_id
      === preparation.execution.recruitment_endpoint_id
    && preparation.authorization.endpoint_purpose
      === preparation.execution.endpoint_purpose
    && preparation.authorization.allowed_http_method
      === preparation.execution.allowed_http_method
    && preparation.authorization.scope === "ONE_ENDPOINT_ONE_RUN";

  return {
    authorization_contract_representable: bindingComplete,
    executable: false,
    approval_status: PENDING_HUMAN_APPROVAL,
    blockers: BEIJING_CANARY_PREPARATION_BLOCKERS
  } as const;
}
