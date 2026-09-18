import {
  InMemorySourceAdmissionRegister,
  SOURCE_PROHIBITED_ACTIONS,
  evaluateSourceAutomationPermission,
  type SourceAdmission
} from "../../application";
import {
  UTF8_TEXT_ENCODING,
  type RecruitmentEndpoint,
  type SnapshotId
} from "../../ingestion";
import {
  GUIZHOU_LEGAL_CANARY_NOTICE_URL,
  GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION
} from "../p2-legal-01/guizhou-legal-canary-admission-preflight";

export const GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL =
  "https://rst.guizhou.gov.cn/zwgk/zdlyxx/sydwgkzp/202502/P020250210600360721175.xlsx";
export const GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID =
  "endpoint-cn-guizhou-rst-judicial-public-institution-recruitment-attachment-xlsx" as RecruitmentEndpoint["recruitment_endpoint_id"];
export const GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_ID =
  "admission-cn-guizhou-rst-judicial-public-institution-recruitment-attachment-xlsx" as SourceAdmission["source_admission_id"];
export const GUIZHOU_NOTICE_SNAPSHOT_ID =
  "p2-legal-02-snapshot:3585d0e1-93a1-4dbd-a451-946acdaa9ee5" as SnapshotId;
export const GUIZHOU_NOTICE_RAW_SHA256 =
  "e517ef5af83b57eea41f953e12117a677e5486cda3b7c521b9888ae5d86b004a";

const PREFLIGHT_REVIEWED_AT = "2026-09-04T00:00:00+08:00";
const PREFLIGHT_REVIEWER = "P2-LEGAL-03 offline attachment admission preflight";
const ROBOTS_EVIDENCE_ID =
  "p2-legal-03-evidence:attachment-robots-unobserved" as SourceAdmission["robots"]["evidence_id"];
const TERMS_EVIDENCE_ID =
  "p2-legal-03-evidence:attachment-terms-unobserved" as SourceAdmission["terms"]["evidence_id"];
const NOTICE_LOCATOR_EVIDENCE_ID =
  "p2-legal-03-evidence:notice-snapshot-attachment-locator" as SourceAdmission["evidence"][number]["source_admission_evidence_id"];

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

export const GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT = {
  recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
  source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.source_definition_id,
  name: traceable("贵州省司法厅所属事业单位2025年公开招聘工作人员岗位及要求一览表附件"),
  description: traceable(
    "P2-LEGAL-03 独立附件 Admission Preflight；尚未访问文件，实际 MIME 与文件类型未知。"
  ),
  coverage_regions: [{ raw_text: original("贵州省") }],
  locator: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
  request_method: "GET",
  content_kind: "FILE",
  adapter_key: "pending-cn-guizhou-rst-recruitment-attachment-file",
  decoded_text_encoding: UTF8_TEXT_ENCODING,
  collection_config: {
    max_items: 1,
    max_pages: 1,
    follow_redirects: false,
    retry_limit: 0
  },
  enabled: false
} as const satisfies RecruitmentEndpoint;

export const GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION = {
  source_admission_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_ID,
  admission_level: "B",
  automation_basis: "INSUFFICIENT_EVIDENCE",
  source_name: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION.name,
  source_type: "OFFICIAL_RECRUITMENT_PAGE",
  official_owner: traceable("贵州省人力资源和社会保障厅"),
  endpoint: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
  recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
  endpoint_purpose: "RECRUITMENT_ATTACHMENT",
  allowed_http_method: "GET",
  content_kind: "FILE",
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
      source_admission_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_ID,
      endpoint: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
      source_url: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
      kind: "ROBOTS",
      locator: "offline-preflight:attachment-robots-not-requested",
      captured_at: PREFLIGHT_REVIEWED_AT,
      reviewer: PREFLIGHT_REVIEWER,
      decision: "UNKNOWN",
      summary: original(
        "本轮不访问 robots.txt，公告 Endpoint 的观察不得替代附件 Endpoint 的 robots 审查；状态保持 UNKNOWN。"
      )
    },
    {
      source_admission_evidence_id: TERMS_EVIDENCE_ID,
      source_admission_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_ID,
      endpoint: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
      source_url: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
      kind: "TERMS",
      locator: "offline-preflight:attachment-terms-not-requested",
      captured_at: PREFLIGHT_REVIEWED_AT,
      reviewer: PREFLIGHT_REVIEWER,
      decision: "UNKNOWN",
      summary: original(
        "本轮不访问网站条款页面，公告 Endpoint 的观察不得替代附件 Endpoint 的条款审查；状态保持 UNKNOWN。"
      )
    },
    {
      source_admission_evidence_id: NOTICE_LOCATOR_EVIDENCE_ID,
      source_admission_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_ID,
      endpoint: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
      source_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
      kind: "ENDPOINT_INSPECTION",
      locator:
        `snapshot://${GUIZHOU_NOTICE_SNAPSHOT_ID}/raw-sha256/${GUIZHOU_NOTICE_RAW_SHA256}#a[href='./P020250210600360721175.xlsx']`,
      captured_at: PREFLIGHT_REVIEWED_AT,
      reviewer: PREFLIGHT_REVIEWER,
      decision: "UNKNOWN",
      summary: original(
        "P2-LEGAL-02 公告 Snapshot 明确引用该精确附件 locator；此证据仅证明官方公告引用关系，不证明附件可访问、实际 MIME、文件类型或自动化许可。"
      )
    }
  ],
  review_records: [
    {
      source_admission_review_id:
        "p2-legal-03-review:attachment-offline-preflight" as SourceAdmission["review_records"][number]["source_admission_review_id"],
      reviewer: PREFLIGHT_REVIEWER,
      reviewed_at: PREFLIGHT_REVIEWED_AT,
      decision: "REVIEW",
      rationale: original(
        "附件 locator 由官方公告 Snapshot 证明，但附件自身的 robots、terms、login、CAPTCHA、Cookie、anti-bot、redirect、MIME 与文件签名均未观察；维持 B + REVIEW + INSUFFICIENT_EVIDENCE。"
      ),
      evidence_ids: [ROBOTS_EVIDENCE_ID, TERMS_EVIDENCE_ID, NOTICE_LOCATOR_EVIDENCE_ID]
    }
  ],
  admission_decision: "REVIEW"
} as const satisfies SourceAdmission;

export const GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_PREFLIGHT = {
  source_definition: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION,
  endpoint_definition: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT,
  admission: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION,
  official_domain: "rst.guizhou.gov.cn",
  locator_provenance: {
    referring_notice_url: GUIZHOU_LEGAL_CANARY_NOTICE_URL,
    referring_notice_snapshot_id: GUIZHOU_NOTICE_SNAPSHOT_ID,
    referring_notice_raw_sha256: GUIZHOU_NOTICE_RAW_SHA256,
    source_anchor_text:
      "附件1：贵州省司法厅所属事业单位2025年公开招聘工作人员岗位及要求一览表.xlsx",
    raw_href: "./P020250210600360721175.xlsx",
    exact_locator: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    proves_official_notice_reference_only: true,
    reused_as_attachment_snapshot: false
  },
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
    anti_bot_state: "UNKNOWN",
    redirect_behavior: "UNKNOWN"
  },
  file_risk_preflight: {
    content_kind: "FILE",
    locator_extension: ".xlsx",
    anchor_label_extension: ".xlsx",
    actual_mime: "UNKNOWN",
    actual_file_type: "UNKNOWN",
    file_signature: "UNKNOWN",
    content_length: "UNKNOWN",
    maximum_response_bytes_after_separate_approval: 10 * 1024 * 1024,
    classification: "REVIEW_REQUIRED_PENDING_FILE_OBSERVATION"
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
  attachment_capture_state: {
    authorization_created: false,
    collection_run_created: false,
    evidence_captured: false,
    raw_created: false,
    snapshot_created: false,
    parsed: false
  },
  endpoint_separation: {
    notice_endpoint_id:
      "endpoint-cn-guizhou-rst-judicial-public-institution-recruitment-notice-html",
    attachment_endpoint_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
    independent_authorization_required: true,
    independent_collection_run_required: true,
    independent_evidence_required: true,
    independent_raw_required: true,
    independent_snapshot_required: true
  },
  next_authorization_gate: {
    required: true,
    status: "PENDING_SEPARATE_HUMAN_APPROVAL",
    target: {
      source_admission_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION_ID,
      recruitment_endpoint_id: GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
      locator: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
      endpoint_purpose: "RECRUITMENT_ATTACHMENT",
      method: "GET",
      content_kind: "FILE",
      authorization_mode: "OBSERVATION_CANARY",
      authorization_purpose: "OBSERVE_ACCESS_PROPERTIES",
      scope: "ONE_ENDPOINT_ONE_RUN"
    }
  }
} as const;

export function inspectGuizhouAttachmentAdmissionPreflight() {
  const register = new InMemorySourceAdmissionRegister();
  const admission = register.register(GUIZHOU_LEGAL_CANARY_ATTACHMENT_ADMISSION);
  const automation = evaluateSourceAutomationPermission(admission);
  return {
    source_admission_valid: true,
    admission_level: admission.admission_level,
    admission_decision: admission.admission_decision,
    automation_basis: admission.automation_basis,
    long_term_automation_allowed: automation.allowed,
    observation_canary_requires_separate_human_approval: true,
    endpoint_executable: false,
    network_requests_performed: 0
  } as const;
}
