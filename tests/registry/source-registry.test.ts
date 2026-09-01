import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySourceRegistry,
  SourceRegistryError,
  UTF8_TEXT_ENCODING,
  type AdapterKeyRegistration,
  type Organization,
  type OrganizationId,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type SourceDefinition,
  type SourceDefinitionId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

const organizationIds = {
  institute: branded<OrganizationId>("org-research-institute"),
  government: branded<OrganizationId>("org-government-portal"),
  platform: branded<OrganizationId>("org-fixture-platform")
};

const sourceIds = {
  institute: branded<SourceDefinitionId>("source-institute-official"),
  instituteNotices: branded<SourceDefinitionId>("source-institute-notices"),
  government: branded<SourceDefinitionId>("source-government-notices"),
  platform: branded<SourceDefinitionId>("source-fixture-platform")
};

const endpointIds = {
  html: branded<RecruitmentEndpointId>("endpoint-official-html"),
  institutePdf: branded<RecruitmentEndpointId>("endpoint-institute-pdf"),
  governmentPdf: branded<RecruitmentEndpointId>("endpoint-government-pdf"),
  json: branded<RecruitmentEndpointId>("endpoint-third-party-json"),
  disabled: branded<RecruitmentEndpointId>("endpoint-disabled"),
  disabledSource: branded<RecruitmentEndpointId>("endpoint-disabled-source")
};

const organizations: readonly Organization[] = [
  {
    organization_id: organizationIds.institute,
    name: traceable("中国科学院某研究所"),
    aliases: [traceable("中科院某研究所")],
    country_code: "CN"
  },
  {
    organization_id: organizationIds.government,
    name: traceable("某市人力资源和社会保障局"),
    aliases: [],
    country_code: "CN"
  },
  {
    organization_id: organizationIds.platform,
    name: traceable("第三方招聘平台 Fixture 发布者"),
    aliases: [],
    country_code: "CN"
  }
];

const sources: readonly SourceDefinition[] = [
  {
    source_definition_id: sourceIds.institute,
    publisher_organization_id: organizationIds.institute,
    name: traceable("研究所官方人才招聘来源"),
    publisher_kind: "RESEARCH_INSTITUTE",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: true
  },
  {
    source_definition_id: sourceIds.instituteNotices,
    publisher_organization_id: organizationIds.institute,
    name: traceable("研究所人才招聘公告来源"),
    publisher_kind: "EMPLOYER_OFFICIAL",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: true
  },
  {
    source_definition_id: sourceIds.government,
    publisher_organization_id: organizationIds.government,
    name: traceable("事业单位公开招聘公告"),
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "REGIONAL",
    enabled: true
  },
  {
    source_definition_id: sourceIds.platform,
    publisher_organization_id: organizationIds.platform,
    name: traceable("全国招聘信息 Fixture 来源"),
    publisher_kind: "THIRD_PARTY_PLATFORM",
    authority_level: "THIRD_PARTY",
    scope: "NATIONAL",
    enabled: true
  }
];

const fixtureAdapter: AdapterKeyRegistration = {
  adapter_key: "fixture",
  name: traceable("FixtureAdapter"),
  supported_content_kinds: ["HTML", "JSON"]
};

const fixtureDocumentAdapter: AdapterKeyRegistration = {
  adapter_key: "fixture-document",
  name: traceable("FixtureDocumentAdapter"),
  supported_content_kinds: ["PDF", "FILE"]
};

function endpoint(
  recruitmentEndpointId: RecruitmentEndpointId,
  sourceDefinitionId: SourceDefinitionId,
  overrides: Partial<RecruitmentEndpoint> = {}
): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: recruitmentEndpointId,
    source_definition_id: sourceDefinitionId,
    name: traceable("中文 Fixture Endpoint"),
    description: traceable("保留中文原始名称与描述，不进行强制英文化。"),
    coverage_regions: [
      { raw_text: original("全国") },
      { raw_text: original("北京市") },
      { raw_text: original("华北地区") },
      { raw_text: original("陕西省") }
    ],
    locator: `fixture://registry/${recruitmentEndpointId}`,
    content_kind: "HTML",
    adapter_key: "fixture",
    decoded_text_encoding: "UTF-8",
    collection_config: {
      timeout_ms: 5_000,
      max_items: 100,
      max_pages: 5,
      follow_redirects: false,
      retry_limit: 1
    },
    enabled: true,
    ...overrides
  };
}

function createRegistry() {
  const registry = new InMemorySourceRegistry();
  registry.registerAdapterKey(fixtureAdapter);
  registry.registerAdapterKey(fixtureDocumentAdapter);
  for (const organization of organizations) registry.registerOrganization(organization);
  for (const source of sources) registry.registerSourceDefinition(source);
  return registry;
}

function assertRegistryError(code: SourceRegistryError["code"]) {
  return (error: unknown) => error instanceof SourceRegistryError && error.code === code;
}

test("Source Registry registers Organization, SourceDefinition, and Endpoint separately", () => {
  const registry = createRegistry();
  const htmlEndpoint = endpoint(endpointIds.html, sourceIds.institute);
  registry.registerRecruitmentEndpoint(htmlEndpoint);

  assert.equal(registry.getOrganization(organizationIds.institute).name.original.text, "中国科学院某研究所");
  assert.equal(registry.getSourceDefinition(sourceIds.institute).publisher_organization_id, organizationIds.institute);
  assert.equal(registry.getRecruitmentEndpoint(endpointIds.html).source_definition_id, sourceIds.institute);
});

test("Endpoint validation accepts fixture locators without HTTP methods", () => {
  const registry = createRegistry();
  const registered = registry.registerRecruitmentEndpoint(
    endpoint(endpointIds.html, sourceIds.institute)
  );
  assert.equal(registered.request_method, undefined);
  assert.equal(registered.collection_config.max_pages, 5);
});

test("Endpoint validation enforces HTTP method and rejects credentials or sensitive parameters", () => {
  const missingMethod = createRegistry();
  assert.throws(
    () => missingMethod.registerRecruitmentEndpoint(endpoint(
      endpointIds.html,
      sourceIds.institute,
      { locator: "https://example.invalid/recruitment" }
    )),
    assertRegistryError("INVALID_ENDPOINT")
  );

  const credentials = createRegistry();
  assert.throws(
    () => credentials.registerRecruitmentEndpoint(endpoint(
      endpointIds.html,
      sourceIds.institute,
      {
        locator: "https://user:password@example.invalid/recruitment",
        request_method: "GET"
      }
    )),
    assertRegistryError("INVALID_ENDPOINT")
  );

  const sensitiveQuery = createRegistry();
  assert.throws(
    () => sensitiveQuery.registerRecruitmentEndpoint(endpoint(
      endpointIds.html,
      sourceIds.institute,
      {
        locator: "https://example.invalid/recruitment?token=secret",
        request_method: "GET"
      }
    )),
    assertRegistryError("INVALID_ENDPOINT")
  );
});

test("collection_config only accepts source-neutral bounded settings", () => {
  const registry = createRegistry();
  assert.throws(
    () => registry.registerRecruitmentEndpoint(endpoint(
      endpointIds.html,
      sourceIds.institute,
      { collection_config: { max_pages: 0 } }
    )),
    assertRegistryError("INVALID_COLLECTION_CONFIG")
  );

  const unknownConfiguration = endpoint(endpointIds.html, sourceIds.institute, {
    collection_config: { max_pages: 2 }
  }) as RecruitmentEndpoint & { collection_config: { platform_page_field: string } };
  Object.assign(unknownConfiguration.collection_config, { platform_page_field: "pageIndex" });
  assert.throws(
    () => registry.registerRecruitmentEndpoint(unknownConfiguration),
    assertRegistryError("INVALID_COLLECTION_CONFIG")
  );
});

test("Adapter Key registration and endpoint resolution stay independent of Adapter behavior", () => {
  const registry = createRegistry();
  registry.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute));
  registry.registerRecruitmentEndpoint(endpoint(
    endpointIds.governmentPdf,
    sourceIds.government,
    {
      content_kind: "PDF",
      adapter_key: "fixture-document",
      locator: "fixture://government/事业单位招聘公告.pdf"
    }
  ));

  assert.equal(registry.resolveAdapterForEndpoint(endpointIds.html).adapter_key, "fixture");
  assert.equal(
    registry.resolveAdapterForEndpoint(endpointIds.governmentPdf).adapter_key,
    "fixture-document"
  );
  assert.throws(
    () => registry.resolveAdapterKey("missing-fixture"),
    assertRegistryError("UNKNOWN_ADAPTER_KEY")
  );
});

test("duplicate IDs and adapter keys are rejected", () => {
  const registry = createRegistry();
  assert.throws(
    () => registry.registerOrganization(organizations[0]),
    assertRegistryError("DUPLICATE_ID")
  );
  assert.throws(
    () => registry.registerSourceDefinition(sources[0]),
    assertRegistryError("DUPLICATE_ID")
  );
  registry.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute));
  assert.throws(
    () => registry.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute)),
    assertRegistryError("DUPLICATE_ID")
  );
  assert.throws(
    () => registry.registerAdapterKey(fixtureAdapter),
    assertRegistryError("DUPLICATE_ADAPTER_KEY")
  );
});

test("reference integrity rejects missing organizations, sources, and adapter keys", () => {
  const missingOrganization = new InMemorySourceRegistry();
  assert.throws(
    () => missingOrganization.registerSourceDefinition(sources[0]),
    assertRegistryError("MISSING_ORGANIZATION")
  );

  const missingSource = new InMemorySourceRegistry();
  missingSource.registerAdapterKey(fixtureAdapter);
  assert.throws(
    () => missingSource.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute)),
    assertRegistryError("MISSING_SOURCE_DEFINITION")
  );

  const missingAdapter = new InMemorySourceRegistry();
  for (const organization of organizations) missingAdapter.registerOrganization(organization);
  missingAdapter.registerSourceDefinition(sources[0]);
  assert.throws(
    () => missingAdapter.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute)),
    assertRegistryError("UNKNOWN_ADAPTER_KEY")
  );
});

test("one Organization can own multiple SourceDefinitions and one source can own multiple Endpoints", () => {
  const registry = createRegistry();
  registry.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute));
  registry.registerRecruitmentEndpoint(endpoint(
    endpointIds.institutePdf,
    sourceIds.institute,
    {
      content_kind: "PDF",
      adapter_key: "fixture-document",
      locator: "fixture://institute/招聘公告.pdf"
    }
  ));

  assert.deepEqual(
    registry.listSourceDefinitionsForOrganization(organizationIds.institute)
      .map((source) => source.source_definition_id),
    [sourceIds.institute, sourceIds.instituteNotices]
  );
  assert.deepEqual(
    registry.listRecruitmentEndpointsForSource(sourceIds.institute)
      .map((registeredEndpoint) => registeredEndpoint.recruitment_endpoint_id),
    [endpointIds.html, endpointIds.institutePdf]
  );
});

test("HTML, government PDF, and third-party JSON coexist with independent source dimensions", () => {
  const registry = createRegistry();
  registry.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute));
  registry.registerRecruitmentEndpoint(endpoint(
    endpointIds.governmentPdf,
    sourceIds.government,
    {
      content_kind: "PDF",
      adapter_key: "fixture-document",
      locator: "fixture://government/事业单位招聘公告.pdf"
    }
  ));
  registry.registerRecruitmentEndpoint(endpoint(
    endpointIds.json,
    sourceIds.platform,
    {
      content_kind: "JSON",
      locator: "fixture://platform/recruitment.json"
    }
  ));

  const collectable = registry.listCollectableEndpoints();
  assert.deepEqual(collectable.map((item) => item.content_kind), ["HTML", "PDF", "JSON"]);
  assert.deepEqual(
    collectable.map((item) => registry.getSourceDefinition(item.source_definition_id).publisher_kind),
    ["RESEARCH_INSTITUTE", "GOVERNMENT_PORTAL", "THIRD_PARTY_PLATFORM"]
  );
});

test("disabled Endpoints and disabled Sources do not enter the collectable list", () => {
  const registry = createRegistry();
  const disabledSourceId = branded<SourceDefinitionId>("source-disabled");
  registry.registerSourceDefinition({
    ...sources[1],
    source_definition_id: disabledSourceId,
    enabled: false
  });
  registry.registerRecruitmentEndpoint(endpoint(
    endpointIds.disabled,
    sourceIds.institute,
    { enabled: false }
  ));
  registry.registerRecruitmentEndpoint(endpoint(
    endpointIds.disabledSource,
    disabledSourceId
  ));
  registry.registerRecruitmentEndpoint(endpoint(endpointIds.html, sourceIds.institute));
  assert.deepEqual(
    registry.listCollectableEndpoints().map((item) => item.recruitment_endpoint_id),
    [endpointIds.html]
  );
});

test("Registry preserves UTF-8 Chinese names, descriptions, and raw coverage regions", () => {
  const registry = createRegistry();
  const registered = registry.registerRecruitmentEndpoint(endpoint(
    endpointIds.governmentPdf,
    sourceIds.government,
    {
      name: traceable("事业单位法律岗位公开招聘公告"),
      content_kind: "PDF",
      adapter_key: "fixture-document",
      locator: "fixture://government/公开招聘公告.pdf"
    }
  ));

  assert.equal(registered.name.original.text, "事业单位法律岗位公开招聘公告");
  assert.equal(registered.description?.original.text, "保留中文原始名称与描述，不进行强制英文化。");
  assert.deepEqual(
    registered.coverage_regions.map((region) => region.raw_text.text),
    ["全国", "北京市", "华北地区", "陕西省"]
  );
  assert.equal(registered.decoded_text_encoding, "UTF-8");
});

test("Registry tests cannot access the network", async () => {
  await assert.rejects(
    fetch("https://example.invalid"),
    /Network access is disabled in tests/
  );
});
