import {
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
  evaluateSourceAutomationPermission,
  type SourceAdmission
} from "../../application";
import {
  UTF8_TEXT_ENCODING,
  type OrganizationId,
  type RecruitmentEndpoint,
  type SourceDefinition
} from "../../ingestion";

export const GUIZHOU_LEGAL_CANARY_NOTICE_URL =
  "https://rst.guizhou.gov.cn/zwgk/zdlyxx/sydwgkzp/202502/t20250210_86799156.html";

export const GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID =
  "source-cn-guizhou-rst-public-institution-recruitment" as SourceDefinition["source_definition_id"];
export const GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID =
  "endpoint-cn-guizhou-rst-judicial-public-institution-recruitment-notice-html" as RecruitmentEndpoint["recruitment_endpoint_id"];
export const GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION_ID =
  "admission-cn-guizhou-rst-judicial-public-institution-recruitment-notice" as SourceAdmission["source_admission_id"];

const GUIZHOU_RSTA_ORGANIZATION_ID =
  "organization-cn-guizhou-rst" as OrganizationId;
const ROBOTS_EVIDENCE_ID =
  "evidence-p2-legal-01-guizhou-notice-robots-unobserved" as SourceAdmission["robots"]["evidence_id"];
const TERMS_EVIDENCE_ID =
  "evidence-p2-legal-01-guizhou-notice-terms-unobserved" as SourceAdmission["terms"]["evidence_id"];
const SOURCE_IDENTITY_EVIDENCE_ID =
  "evidence-p2-legal-01-guizhou-notice-source-identity" as SourceAdmission["evidence"][number]["source_admission_evidence_id"];
const PREFLIGHT_REVIEWED_AT = "2026-09-03T00:00:00+08:00";
const PREFLIGHT_REVIEWER = "P2-LEGAL-01 offline admission preflight";

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

export const GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION = {
  source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
  publisher_organization_id: GUIZHOU_RSTA_ORGANIZATION_ID,
  name: traceable("贵州省人力资源和社会保障厅事业单位公开招聘公告来源"),
  publisher_kind: "GOVERNMENT_PORTAL",
  authority_level: "OFFICIAL",
  scope: "REGIONAL",
  enabled: false
} as const satisfies SourceDefinition;

export const GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT = {
  recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
  source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
  name: traceable("贵州省司法厅所属事业单位2025年公开招聘工作人员公告"),
  description: traceable("P2-LEGAL-01 只读 Admission Preflight；尚未进行网络观察。"),
  coverage_regions: [{ raw_text: original("贵州省") }],
  locator: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
  request_method: "GET",
  content_kind: "HTML",
  adapter_key: "pending-cn-guizhou-rst-recruitment-notice-html",
  decoded_text_encoding: UTF8_TEXT_ENCODING,
  collection_config: {
    max_items: 1,
    max_pages: 1,
    follow_redirects: false,
    retry_limit: 0
  },
  enabled: false
} as const satisfies RecruitmentEndpoint;

export const GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION = {
  source_admission_id: GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION_ID,
  admission_level: "B",
  automation_basis: "INSUFFICIENT_EVIDENCE",
  source_name: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.name,
  source_type: "OFFICIAL_RECRUITMENT_PAGE",
  official_owner: traceable("贵州省人力资源和社会保障厅"),
  endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
  recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
  endpoint_purpose: "RECRUITMENT_NOTICE",
  allowed_http_method: "GET",
  content_kind: "HTML",
  source_authority: "OFFICIAL",
  robots: {
    status: "UNKNOWN",
    evidence_id: ROBOTS_EVIDENCE_ID
  },
  terms: {
    status: "UNKNOWN",
    evidence_id: TERMS_EVIDENCE_ID
  },
  login_requirement: "UNKNOWN",
  captcha: "UNKNOWN",
  structure: "UNKNOWN",
  stability: "UNKNOWN",
  update_frequency: "UNKNOWN",
  priority: "HIGH",
  prohibited_actions: SOURCE_PROHIBITED_ACTIONS,
  evidence: [
    {
      source_admission_evidence_id: ROBOTS_EVIDENCE_ID,
      source_admission_id: GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION_ID,
      endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      source_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      kind: "ROBOTS",
      locator: "offline-preflight:robots-not-requested",
      captured_at: PREFLIGHT_REVIEWED_AT,
      reviewer: PREFLIGHT_REVIEWER,
      decision: "UNKNOWN",
      summary: original("本轮禁止访问 robots.txt；无独立 robots 网络证据，状态保持 UNKNOWN。")
    },
    {
      source_admission_evidence_id: TERMS_EVIDENCE_ID,
      source_admission_id: GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION_ID,
      endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      source_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      kind: "TERMS",
      locator: "offline-preflight:terms-not-requested",
      captured_at: PREFLIGHT_REVIEWED_AT,
      reviewer: PREFLIGHT_REVIEWER,
      decision: "UNKNOWN",
      summary: original("本轮禁止访问网站条款页面；无独立条款网络证据，状态保持 UNKNOWN。")
    },
    {
      source_admission_evidence_id: SOURCE_IDENTITY_EVIDENCE_ID,
      source_admission_id: GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION_ID,
      endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      source_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      kind: "MANUAL_REVIEW",
      locator: "operator-selected-exact-official-notice-url",
      captured_at: PREFLIGHT_REVIEWED_AT,
      reviewer: PREFLIGHT_REVIEWER,
      decision: "UNKNOWN",
      summary: original(
        "人工选定 URL 位于 rst.guizhou.gov.cn 官方政务域名，并指向贵州省司法厅所属事业单位招聘公告；访问属性仍待独立 Observation Canary 观察。"
      )
    }
  ],
  review_records: [
    {
      source_admission_review_id:
        "review-p2-legal-01-guizhou-notice-offline-preflight" as SourceAdmission["review_records"][number]["source_admission_review_id"],
      reviewer: PREFLIGHT_REVIEWER,
      reviewed_at: PREFLIGHT_REVIEWED_AT,
      decision: "REVIEW",
      rationale: original(
        "官方公开招聘公告身份可建立，但 robots、terms、login、CAPTCHA、Cookie、redirect 与 anti-bot 均未被网络观察；维持 B + REVIEW + INSUFFICIENT_EVIDENCE。"
      ),
      evidence_ids: [ROBOTS_EVIDENCE_ID, TERMS_EVIDENCE_ID, SOURCE_IDENTITY_EVIDENCE_ID]
    }
  ],
  admission_decision: "REVIEW"
} as const satisfies SourceAdmission;

export const GUIZHOU_LEGAL_CANARY_ADMISSION_PREFLIGHT = {
  source_definition: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION,
  endpoint_definition: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
  admission: GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION,
  official_domain: "rst.guizhou.gov.cn",
  official_identity_basis: "OPERATOR_SELECTED_GOV_CN_ENDPOINT",
  robots_evidence: {
    status: "UNKNOWN",
    evidence_id: ROBOTS_EVIDENCE_ID,
    network_observed: false
  },
  terms_evidence: {
    status: "UNKNOWN",
    evidence_id: TERMS_EVIDENCE_ID,
    network_observed: false
  },
  access_properties: {
    login_state: "UNKNOWN",
    captcha_state: "UNKNOWN",
    cookie_state: "UNKNOWN",
    authorization_state: "NOT_CREATED",
    anti_bot_state: "UNKNOWN",
    redirect_behavior: "UNKNOWN"
  },
  redirect_policy: {
    follow_redirects: false,
    on_redirect: "STOP_AND_REVIEW"
  },
  network_policy: {
    mode: "NO_NETWORK_PREFLIGHT",
    requests_performed: 0,
    exact_endpoint_only: true,
    allowed_method: "GET",
    request_budget_after_separate_approval: 1,
    retry_limit: 0,
    send_cookie: false,
    send_authorization_header: false,
    use_proxy_bypass: false,
    use_browser_automation: false
  },
  attachment_candidate: {
    title: "附件1《贵州省司法厅所属事业单位2025年公开招聘工作人员岗位一览表》",
    expected_content_kind: "FILE",
    expected_file_type: "XLSX",
    locator: null,
    endpoint_created: false,
    status: "EXACT_LOCATOR_PENDING_NOTICE_OBSERVATION"
  },
  next_authorization_gate: {
    required: true,
    status: "PENDING_SEPARATE_HUMAN_APPROVAL",
    target: {
      source_admission_id: GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION_ID,
      recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
      locator: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      endpoint_purpose: "RECRUITMENT_NOTICE",
      method: "GET",
      content_kind: "HTML",
      authorization_mode: "OBSERVATION_CANARY",
      authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
      scope: "ONE_ENDPOINT_ONE_RUN"
    }
  }
} as const;

export function inspectGuizhouLegalCanaryAdmissionPreflight() {
  const register = new InMemorySourceAdmissionRegister();
  const admission = register.register(GUIZHOU_LEGAL_CANARY_NOTICE_ADMISSION);
  const automation = evaluateSourceAutomationPermission(admission);

  return {
    source_admission_valid: true,
    admission_level: admission.admission_level,
    admission_decision: admission.admission_decision,
    automation_basis: admission.automation_basis,
    long_term_automation_allowed: automation.allowed,
    observation_canary_requires_separate_human_approval: true,
    endpoint_executable: false,
    attachment_endpoint_created: false,
    network_requests_performed: 0
  } as const;
}
