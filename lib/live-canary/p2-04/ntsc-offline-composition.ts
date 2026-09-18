import {
  InMemorySourceRegistry,
  UTF8_TEXT_ENCODING,
  type Organization,
  type OrganizationId,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type SourceDefinition,
  type SourceDefinitionId
} from "../../ingestion";
import {
  NTSC_LIVE_STRUCTURE_STATUS,
  NTSC_OFFICIAL_HTML_ADAPTER_KEY,
  NTSC_SYNTHETIC_HTML_STRUCTURE,
  NTSC_TALENT_LIST_LOCATOR,
  NtscOfficialHtmlAdapter
} from "./ntsc-official-html-adapter";

export const NTSC_ORGANIZATION_ID = "org-cn-cas-ntsc" as OrganizationId;
export const NTSC_SOURCE_DEFINITION_ID =
  "source-cn-cas-ntsc-official-recruitment" as SourceDefinitionId;
export const NTSC_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-cas-ntsc-talent-recruitment-list-html" as RecruitmentEndpointId;

export const NTSC_ORGANIZATION: Organization = {
  organization_id: NTSC_ORGANIZATION_ID,
  name: traceable("中国科学院国家授时中心"),
  aliases: [
    traceable("国家授时中心"),
    traceable("National Time Service Center, Chinese Academy of Sciences")
  ],
  country_code: "CN"
};

export const NTSC_SOURCE_DEFINITION: SourceDefinition = {
  source_definition_id: NTSC_SOURCE_DEFINITION_ID,
  publisher_organization_id: NTSC_ORGANIZATION_ID,
  name: traceable("中国科学院国家授时中心官方招聘网站"),
  publisher_kind: "RESEARCH_INSTITUTE",
  authority_level: "OFFICIAL",
  scope: "SINGLE_ORGANIZATION",
  enabled: false
};

export const NTSC_RECRUITMENT_ENDPOINT: RecruitmentEndpoint = {
  recruitment_endpoint_id: NTSC_RECRUITMENT_ENDPOINT_ID,
  source_definition_id: NTSC_SOURCE_DEFINITION_ID,
  name: traceable("人才招聘列表"),
  description: traceable("P2-04 离线准备；真实 DOM selector 尚待人工授权后的 Canary 确认。"),
  coverage_regions: [],
  locator: NTSC_TALENT_LIST_LOCATOR,
  request_method: "GET",
  content_kind: "HTML",
  adapter_key: NTSC_OFFICIAL_HTML_ADAPTER_KEY,
  decoded_text_encoding: UTF8_TEXT_ENCODING,
  collection_config: {
    timeout_ms: 5_000,
    max_items: 1,
    max_pages: 1,
    follow_redirects: false,
    retry_limit: 0
  },
  enabled: false
};

export function createNtscOfflinePreparationComposition() {
  const registry = new InMemorySourceRegistry();
  const adapter = new NtscOfficialHtmlAdapter(NTSC_SYNTHETIC_HTML_STRUCTURE);
  registry.registerAdapterKey({
    adapter_key: NTSC_OFFICIAL_HTML_ADAPTER_KEY,
    name: traceable("国家授时中心官方 HTML Adapter（离线准备）"),
    supported_content_kinds: ["HTML"]
  });
  registry.registerOrganization(NTSC_ORGANIZATION);
  registry.registerSourceDefinition(NTSC_SOURCE_DEFINITION);
  registry.registerRecruitmentEndpoint(NTSC_RECRUITMENT_ENDPOINT);
  return {
    registry,
    adapter,
    organization: NTSC_ORGANIZATION,
    source_definition: NTSC_SOURCE_DEFINITION,
    recruitment_endpoint: NTSC_RECRUITMENT_ENDPOINT,
    live_structure_status: NTSC_LIVE_STRUCTURE_STATUS
  } as const;
}

function traceable(text: string) {
  return { original: { text, encoding: UTF8_TEXT_ENCODING } } as const;
}
