import { canonicalHash } from "../../ingestion/normalization/canonical-artifact-registry";

export interface QueryAuthorizationContent {
  schema_version: "query-authorization/2.0.0";
  base_exact_url: string;
  parameters: { name: string; required: boolean; allowed_values: string[] }[];
  approved_combinations: { name: string; value: string }[][];
  pagination: null | { parameter: string; minimum_page: number; maximum_page: number; ordering: "ASCENDING_INTEGER"; empty_stop: "STOP"; repeated_content_stop: "STOP" };
  maximum_pages: number;
  request_budget: number;
  canonicalization: "QUERY_ASCII_RFC3986_V1";
}

export type QueryAuthorizationContract = Readonly<QueryAuthorizationContent> & { readonly contract_hash: string };

function deny(): never { throw new Error("QUERY_CONTRACT_DENIED"); }
function exactKeys(value: object, keys: readonly string[]) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) deny();
}
function bounded(value: number, ceiling: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) deny();
}
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
function ordered(combination: readonly { name: string; value: string }[]): string {
  return [...combination].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map(pair => `${encode(pair.name)}=${encode(pair.value)}`).join("&");
}

function validate(content: QueryAuthorizationContent) {
  exactKeys(content, ["schema_version", "base_exact_url", "parameters", "approved_combinations", "pagination", "maximum_pages", "request_budget", "canonicalization"]);
  if (content.schema_version !== "query-authorization/2.0.0" || content.canonicalization !== "QUERY_ASCII_RFC3986_V1") deny();
  const base = new URL(content.base_exact_url);
  if (base.protocol !== "https:" || base.href !== content.base_exact_url || base.port || base.search || base.hash || base.username || base.password) deny();
  bounded(content.maximum_pages, 32); bounded(content.request_budget, 64);
  if (!Array.isArray(content.parameters) || !content.parameters.length || content.parameters.length > 8) deny();
  const names = new Set<string>();
  for (const parameter of content.parameters) {
    exactKeys(parameter, ["name", "required", "allowed_values"]);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(parameter.name) || /token|password|secret|session|credential|cookie|authorization|api_?key/i.test(parameter.name)
      || names.has(parameter.name) || typeof parameter.required !== "boolean") deny();
    names.add(parameter.name);
    if (!Array.isArray(parameter.allowed_values) || !parameter.allowed_values.length || parameter.allowed_values.length > 64
      || new Set(parameter.allowed_values).size !== parameter.allowed_values.length) deny();
    for (const value of parameter.allowed_values) {
      if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 128 || /[\u0000-\u001f\u007f]/u.test(value)) deny();
      encode(value);
    }
  }
  if (content.pagination !== null) {
    const pagination = content.pagination;
    exactKeys(pagination, ["parameter", "minimum_page", "maximum_page", "ordering", "empty_stop", "repeated_content_stop"]);
    bounded(pagination.minimum_page, Number.MAX_SAFE_INTEGER); bounded(pagination.maximum_page, Number.MAX_SAFE_INTEGER);
    if (pagination.maximum_page < pagination.minimum_page || pagination.maximum_page - pagination.minimum_page + 1 > content.maximum_pages
      || pagination.ordering !== "ASCENDING_INTEGER" || pagination.empty_stop !== "STOP" || pagination.repeated_content_stop !== "STOP") deny();
    const parameter = content.parameters.find(entry => entry.name === pagination.parameter);
    if (!parameter || parameter.allowed_values.some(value => !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))
      || Number(value) < pagination.minimum_page || Number(value) > pagination.maximum_page)) deny();
  }
  if (!Array.isArray(content.approved_combinations) || !content.approved_combinations.length || content.approved_combinations.length > 64) deny();
  const combinations = new Set<string>();
  for (const combination of content.approved_combinations) {
    if (!Array.isArray(combination) || combination.length > 8) deny();
    const seen = new Set<string>();
    for (const pair of combination) {
      exactKeys(pair, ["name", "value"]);
      const parameter = content.parameters.find(entry => entry.name === pair.name);
      if (!parameter || seen.has(pair.name) || !parameter.allowed_values.includes(pair.value)) deny();
      seen.add(pair.name);
    }
    if (content.parameters.some(parameter => parameter.required && !seen.has(parameter.name))) deny();
    const serialized = ordered(combination);
    if (combinations.has(serialized)) deny();
    combinations.add(serialized);
  }
}

export function sealQueryAuthorizationContract(input: QueryAuthorizationContent): QueryAuthorizationContract {
  const content = structuredClone(input);
  validate(content);
  return { ...content, contract_hash: canonicalHash(content) };
}

export function assertQueryAuthorizationContract(contract: QueryAuthorizationContract): void {
  exactKeys(contract, ["schema_version", "base_exact_url", "parameters", "approved_combinations", "pagination", "maximum_pages", "request_budget", "canonicalization", "contract_hash"]);
  const { contract_hash, ...content } = contract;
  validate(content);
  if (contract_hash !== canonicalHash(content)) deny();
}

export function canonicalizeApprovedQueryTarget(rawUrl: string, contract: QueryAuthorizationContract): string {
  assertQueryAuthorizationContract(contract);
  if (typeof rawUrl !== "string" || /[\u0000-\u0020\u007f]/u.test(rawUrl)) deny();
  const split = rawUrl.indexOf("?");
  const rawBase = split < 0 ? rawUrl : rawUrl.slice(0, split);
  if (rawBase !== contract.base_exact_url || rawUrl.includes("#")) deny();
  const pairs: { name: string; value: string }[] = [];
  const names = new Set<string>();
  if (split >= 0) {
    const query = rawUrl.slice(split + 1);
    if (!query || query.includes("+")) deny();
    for (const component of query.split("&")) {
      const separator = component.indexOf("=");
      if (separator < 1) deny();
      const rawName = component.slice(0, separator); const rawValue = component.slice(separator + 1);
      const name = decodeURIComponent(rawName); const value = decodeURIComponent(rawValue);
      if (encode(name) !== rawName || encode(value) !== rawValue || names.has(name)) deny();
      names.add(name); pairs.push({ name, value });
    }
  }
  const query = ordered(pairs);
  if (!contract.approved_combinations.some(combination => ordered(combination) === query)) deny();
  return `${contract.base_exact_url}${query ? `?${query}` : ""}`;
}

export function assertApprovedQueryRequest(rawUrl: string, contract: QueryAuthorizationContract): void {
  if (canonicalizeApprovedQueryTarget(rawUrl, contract) !== rawUrl) deny();
}

export function materializeApprovedQueryTargets(contract: QueryAuthorizationContract): readonly string[] {
  assertQueryAuthorizationContract(contract);
  return contract.approved_combinations.map(combination => {
    const query = ordered(combination);
    return `${contract.base_exact_url}${query ? `?${query}` : ""}`;
  }).sort();
}
