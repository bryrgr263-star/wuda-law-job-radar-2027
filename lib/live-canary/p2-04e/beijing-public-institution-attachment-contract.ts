import type { RecruitmentEndpointId, SourceDefinitionId } from "../../ingestion";

export const BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID =
  "source-cn-beijing-government-public-institution-recruitment" as SourceDefinitionId;
export const BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-beijing-government-public-institution-recruitment-attachment-xlsx" as
    RecruitmentEndpointId;
export const BEIJING_ATTACHMENT_ENDPOINT =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/P020260625349755441673.xlsx";
export const BEIJING_ATTACHMENT_REFERRING_DETAIL_ENDPOINT =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html";
export const BEIJING_ATTACHMENT_EXPECTED_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const BEIJING_ATTACHMENT_OBSERVATION_TIMEOUT_MS = 15_000;
export const BEIJING_ATTACHMENT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const BEIJING_ATTACHMENT_MAX_ZIP_ENTRIES = 256;
export const BEIJING_ATTACHMENT_MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
export const BEIJING_ATTACHMENT_MAX_SINGLE_ENTRY_BYTES = 16 * 1024 * 1024;
export const BEIJING_ATTACHMENT_MAX_EXPANSION_RATIO = 100;
