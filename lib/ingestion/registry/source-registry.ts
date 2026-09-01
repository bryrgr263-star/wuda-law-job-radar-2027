import type {
  ContentKind,
  Organization,
  OrganizationId,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  SourceDefinition,
  SourceDefinitionId
} from "../domain";
import {
  SourceRegistryError,
  type AdapterKeyRegistration
} from "./types";
import {
  validateAdapterKey,
  validateRecruitmentEndpoint
} from "./validation";

export class InMemorySourceRegistry {
  readonly #organizations = new Map<OrganizationId, Organization>();
  readonly #sources = new Map<SourceDefinitionId, SourceDefinition>();
  readonly #endpoints = new Map<RecruitmentEndpointId, RecruitmentEndpoint>();
  readonly #adapterKeys = new Map<string, AdapterKeyRegistration>();

  registerOrganization(organization: Organization) {
    if (this.#organizations.has(organization.organization_id)) {
      throw new SourceRegistryError(
        "DUPLICATE_ID",
        `Organization already exists: ${organization.organization_id}`
      );
    }
    this.#organizations.set(organization.organization_id, organization);
    return organization;
  }

  registerSourceDefinition(source: SourceDefinition) {
    if (this.#sources.has(source.source_definition_id)) {
      throw new SourceRegistryError(
        "DUPLICATE_ID",
        `Source definition already exists: ${source.source_definition_id}`
      );
    }
    if (!this.#organizations.has(source.publisher_organization_id)) {
      throw new SourceRegistryError(
        "MISSING_ORGANIZATION",
        `Publisher organization does not exist: ${source.publisher_organization_id}`
      );
    }
    this.#sources.set(source.source_definition_id, source);
    return source;
  }

  registerRecruitmentEndpoint(endpoint: RecruitmentEndpoint) {
    if (this.#endpoints.has(endpoint.recruitment_endpoint_id)) {
      throw new SourceRegistryError(
        "DUPLICATE_ID",
        `Recruitment endpoint already exists: ${endpoint.recruitment_endpoint_id}`
      );
    }
    if (!this.#sources.has(endpoint.source_definition_id)) {
      throw new SourceRegistryError(
        "MISSING_SOURCE_DEFINITION",
        `Source definition does not exist: ${endpoint.source_definition_id}`
      );
    }
    validateRecruitmentEndpoint(endpoint);
    const adapter = this.#adapterKeys.get(endpoint.adapter_key);
    if (!adapter) {
      throw new SourceRegistryError(
        "UNKNOWN_ADAPTER_KEY",
        `Adapter key is not registered: ${endpoint.adapter_key}`
      );
    }
    if (!adapter.supported_content_kinds.includes(endpoint.content_kind)) {
      throw new SourceRegistryError(
        "UNSUPPORTED_CONTENT_KIND",
        `Adapter ${endpoint.adapter_key} does not support ${endpoint.content_kind}`
      );
    }
    this.#endpoints.set(endpoint.recruitment_endpoint_id, endpoint);
    return endpoint;
  }

  registerAdapterKey(registration: AdapterKeyRegistration) {
    validateAdapterKey(registration.adapter_key);
    if (this.#adapterKeys.has(registration.adapter_key)) {
      throw new SourceRegistryError(
        "DUPLICATE_ADAPTER_KEY",
        `Adapter key already exists: ${registration.adapter_key}`
      );
    }
    if (registration.supported_content_kinds.length === 0) {
      throw new SourceRegistryError(
        "INVALID_ADAPTER_KEY",
        `Adapter key must support at least one content kind: ${registration.adapter_key}`
      );
    }
    this.#adapterKeys.set(registration.adapter_key, registration);
    return registration;
  }

  getOrganization(organizationId: OrganizationId) {
    const organization = this.#organizations.get(organizationId);
    if (!organization) {
      throw new SourceRegistryError(
        "MISSING_ORGANIZATION",
        `Organization does not exist: ${organizationId}`
      );
    }
    return organization;
  }

  getSourceDefinition(sourceDefinitionId: SourceDefinitionId) {
    const source = this.#sources.get(sourceDefinitionId);
    if (!source) {
      throw new SourceRegistryError(
        "MISSING_SOURCE_DEFINITION",
        `Source definition does not exist: ${sourceDefinitionId}`
      );
    }
    return source;
  }

  getRecruitmentEndpoint(endpointId: RecruitmentEndpointId) {
    const endpoint = this.#endpoints.get(endpointId);
    if (!endpoint) {
      throw new SourceRegistryError(
        "MISSING_ENDPOINT",
        `Recruitment endpoint does not exist: ${endpointId}`
      );
    }
    return endpoint;
  }

  resolveAdapterKey(adapterKey: string) {
    const registration = this.#adapterKeys.get(adapterKey);
    if (!registration) {
      throw new SourceRegistryError(
        "UNKNOWN_ADAPTER_KEY",
        `Adapter key is not registered: ${adapterKey}`
      );
    }
    return registration;
  }

  resolveAdapterForEndpoint(endpointId: RecruitmentEndpointId) {
    return this.resolveAdapterKey(this.getRecruitmentEndpoint(endpointId).adapter_key);
  }

  listOrganizations() {
    return [...this.#organizations.values()];
  }

  listSourceDefinitionsForOrganization(organizationId: OrganizationId) {
    this.getOrganization(organizationId);
    return [...this.#sources.values()].filter(
      (source) => source.publisher_organization_id === organizationId
    );
  }

  listRecruitmentEndpointsForSource(sourceDefinitionId: SourceDefinitionId) {
    this.getSourceDefinition(sourceDefinitionId);
    return [...this.#endpoints.values()].filter(
      (endpoint) => endpoint.source_definition_id === sourceDefinitionId
    );
  }

  listCollectableEndpoints(contentKinds?: ReadonlySet<ContentKind>) {
    return [...this.#endpoints.values()].filter((endpoint) => {
      if (!endpoint.enabled) return false;
      const source = this.#sources.get(endpoint.source_definition_id);
      if (!source?.enabled) return false;
      return !contentKinds || contentKinds.has(endpoint.content_kind);
    });
  }
}
