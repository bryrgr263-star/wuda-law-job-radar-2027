export interface LocalHttpEgressPolicy {
  readonly execution_scope: "P2_03_LOCAL_TEST";
  readonly allowed_origins: readonly string[];
}

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

export function createLocalHttpEgressPolicy(
  allowedOrigins: readonly string[]
): LocalHttpEgressPolicy {
  if (allowedOrigins.length === 0) {
    throw new Error("P2-03 HTTP Transport requires an explicit local test origin");
  }
  const normalizedOrigins = allowedOrigins.map(validateLocalOrigin);
  return {
    execution_scope: "P2_03_LOCAL_TEST",
    allowed_origins: [...new Set(normalizedOrigins)].sort()
  };
}

export function assertLocalHttpEgressAllowed(
  policy: LocalHttpEgressPolicy,
  locator: string
) {
  const parsed = parseHttpUrl(locator);
  const origin = parsed.origin;
  if (!policy.allowed_origins.includes(origin)) {
    throw new Error(`P2-03 egress denied for unapproved endpoint: ${origin}`);
  }
  return parsed;
}

function validateLocalOrigin(origin: string) {
  const parsed = parseHttpUrl(origin);
  if (parsed.origin !== origin.replace(/\/$/u, "")) {
    throw new Error(`P2-03 allowed origin must not include a path: ${origin}`);
  }
  if (!loopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error(`P2-03 only permits loopback test servers: ${parsed.hostname}`);
  }
  return parsed.origin;
}

function parseHttpUrl(locator: string) {
  let parsed: URL;
  try {
    parsed = new URL(locator);
  } catch {
    throw new Error(`P2-03 HTTP Transport requires an absolute URL: ${locator}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`P2-03 only permits HTTP(S) test endpoints: ${locator}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("P2-03 HTTP Transport rejects URL credentials");
  }
  return parsed;
}
