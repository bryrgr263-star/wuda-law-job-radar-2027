import {
  CONTENT_KINDS,
  HTTP_REQUEST_METHODS,
  UTF8_TEXT_ENCODING,
  type RecruitmentEndpoint
} from "../domain";
import { SourceRegistryError } from "./types";

const endpointKeys = new Set([
  "recruitment_endpoint_id",
  "source_definition_id",
  "name",
  "description",
  "coverage_regions",
  "locator",
  "request_method",
  "content_kind",
  "adapter_key",
  "decoded_text_encoding",
  "collection_config",
  "enabled"
]);

const collectionConfigKeys = new Set([
  "timeout_ms",
  "max_items",
  "max_pages",
  "follow_redirects",
  "retry_limit"
]);

const sensitiveLocatorParameter = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key)/i;
const adapterKeyPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export function validateAdapterKey(adapterKey: string) {
  if (!adapterKeyPattern.test(adapterKey)) {
    throw new SourceRegistryError(
      "INVALID_ADAPTER_KEY",
      `Invalid adapter key: ${adapterKey}`
    );
  }
}

export function validateRecruitmentEndpoint(endpoint: RecruitmentEndpoint) {
  validateKnownKeys(endpoint as unknown as Record<string, unknown>, endpointKeys, "endpoint");
  validateAdapterKey(endpoint.adapter_key);

  if (endpoint.decoded_text_encoding !== UTF8_TEXT_ENCODING) {
    throw new SourceRegistryError("INVALID_ENDPOINT", "Endpoint text encoding must be UTF-8");
  }
  if (!CONTENT_KINDS.includes(endpoint.content_kind)) {
    throw new SourceRegistryError("INVALID_ENDPOINT", "Endpoint content kind is not supported");
  }

  const locator = parseLocator(endpoint.locator);
  const usesHttp = locator.protocol === "http:" || locator.protocol === "https:";
  if (usesHttp && !endpoint.request_method) {
    throw new SourceRegistryError(
      "INVALID_ENDPOINT",
      "HTTP endpoints must declare request_method"
    );
  }
  if (!usesHttp && endpoint.request_method) {
    throw new SourceRegistryError(
      "INVALID_ENDPOINT",
      "Non-HTTP endpoints cannot declare request_method"
    );
  }
  if (endpoint.request_method && !HTTP_REQUEST_METHODS.includes(endpoint.request_method)) {
    throw new SourceRegistryError("INVALID_ENDPOINT", "Endpoint request method is not supported");
  }
  if (locator.username || locator.password) {
    throw new SourceRegistryError("INVALID_ENDPOINT", "Endpoint locator cannot contain credentials");
  }
  for (const parameterName of locator.searchParams.keys()) {
    if (sensitiveLocatorParameter.test(parameterName)) {
      throw new SourceRegistryError(
        "INVALID_ENDPOINT",
        `Endpoint locator cannot contain sensitive parameter: ${parameterName}`
      );
    }
  }

  validateCollectionConfig(endpoint.collection_config);
  validateOriginalText(endpoint.name.original.text, "Endpoint name");
  if (endpoint.description) validateOriginalText(endpoint.description.original.text, "Endpoint description");
  for (const region of endpoint.coverage_regions) {
    validateOriginalText(region.raw_text.text, "Coverage region");
  }
}

function parseLocator(locator: string) {
  try {
    return new URL(locator);
  } catch {
    throw new SourceRegistryError("INVALID_ENDPOINT", `Invalid endpoint locator: ${locator}`);
  }
}

function validateCollectionConfig(config: RecruitmentEndpoint["collection_config"]) {
  validateKnownKeys(
    config as unknown as Record<string, unknown>,
    collectionConfigKeys,
    "collection_config"
  );
  validatePositiveInteger(config.timeout_ms, "timeout_ms");
  validatePositiveInteger(config.max_items, "max_items");
  validatePositiveInteger(config.max_pages, "max_pages");
  validatePositiveInteger(config.retry_limit, "retry_limit", true);
  if (config.follow_redirects !== undefined && typeof config.follow_redirects !== "boolean") {
    throw new SourceRegistryError(
      "INVALID_COLLECTION_CONFIG",
      "follow_redirects must be a boolean"
    );
  }
}

function validatePositiveInteger(value: number | undefined, field: string, allowZero = false) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new SourceRegistryError(
      "INVALID_COLLECTION_CONFIG",
      `${field} must be ${allowZero ? "a non-negative" : "a positive"} integer`
    );
  }
}

function validateKnownKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string
) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new SourceRegistryError(
      label === "collection_config" ? "INVALID_COLLECTION_CONFIG" : "INVALID_ENDPOINT",
      `${label} contains unsupported fields: ${unknownKeys.join(", ")}`
    );
  }
}

function validateOriginalText(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new SourceRegistryError("INVALID_ENDPOINT", `${label} cannot be empty`);
  }
}
