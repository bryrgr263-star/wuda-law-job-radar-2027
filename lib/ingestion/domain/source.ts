import type {
  OrganizationId,
  RecruitmentEndpointId,
  SourceDefinitionId
} from "./primitives";
import type { TraceableText, TextEncoding } from "./text";

export const PUBLISHER_KINDS = [
  "EMPLOYER_OFFICIAL",
  "GOVERNMENT_PORTAL",
  "UNIVERSITY_BOARD",
  "RESEARCH_INSTITUTE",
  "LAW_FIRM",
  "INDUSTRY_SYSTEM",
  "THIRD_PARTY_PLATFORM"
] as const;

export const AUTHORITY_LEVELS = [
  "OFFICIAL",
  "AUTHORIZED",
  "THIRD_PARTY",
  "UNKNOWN"
] as const;

export const SOURCE_SCOPES = [
  "SINGLE_ORGANIZATION",
  "MULTI_ORGANIZATION",
  "REGIONAL",
  "NATIONAL"
] as const;

export const CONTENT_KINDS = [
  "HTML",
  "JSON",
  "PDF",
  "RSS",
  "SITEMAP",
  "FILE"
] as const;

export type PublisherKind = (typeof PUBLISHER_KINDS)[number];
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];
export type SourceScope = (typeof SOURCE_SCOPES)[number];
export type ContentKind = (typeof CONTENT_KINDS)[number];

export interface Organization {
  readonly organization_id: OrganizationId;
  readonly name: TraceableText;
  readonly aliases: readonly TraceableText[];
  readonly country_code?: string;
}

export interface SourceDefinition {
  readonly source_definition_id: SourceDefinitionId;
  readonly publisher_organization_id?: OrganizationId;
  readonly name: TraceableText;
  readonly publisher_kind: PublisherKind;
  readonly authority_level: AuthorityLevel;
  readonly scope: SourceScope;
  readonly enabled: boolean;
}

export interface RecruitmentEndpoint {
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly source_definition_id: SourceDefinitionId;
  readonly name: TraceableText;
  readonly locator: string;
  readonly content_kind: ContentKind;
  readonly adapter_key: string;
  readonly decoded_text_encoding: TextEncoding;
  readonly enabled: boolean;
}
