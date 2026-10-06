import { isIP } from "node:net";

export function safeDiscoveryUrl(value: string): string {
  let url: URL;
  let decoded: string;
  try { url = new URL(value); decoded = decodeURIComponent(url.pathname + url.search); }
  catch { throw new Error("DISCOVERY_TARGET_DENIED"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port
    || url.href !== value || isIP(url.hostname) || !/^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
    || /\.(local|localhost|internal|test|invalid)$/i.test(url.hostname)
    || /@|\b1[3-9]\d{9}\b|[a-f0-9]{24,}|(?:token|secret|password|session|credential|bearer)/i.test(decoded)
    || [...url.searchParams.entries()].some(([key, content]) => !/^(?:page|size|offset|limit|id|kinds|schType|level|obj_id)$/i.test(key) || !/^\d{1,12}$/.test(content))) {
    throw new Error("DISCOVERY_TARGET_DENIED");
  }
  return value;
}

export function publicDiscoveryAddress(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const parts = value.split(".").map(Number);
  const [first, second] = parts;
  if (first === 0 || first === 10 || first === 127 || first! >= 224
    || (first === 100 && second! >= 64 && second! <= 127)
    || (first === 169 && second === 254) || (first === 172 && second! >= 16 && second! <= 31)
    || (first === 192 && (second === 168 || second === 0))
    || (first === 198 && (second === 18 || second === 19 || (second === 51 && parts[2] === 100)))
    || (first === 203 && second === 0 && parts[2] === 113)) return false;
  return true;
}

export function safeDiscoveryText(value: string): string {
  return value.replace(/<[^>]*>/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?86[- ]?)?1[3-9]\d{9}\b/g, "[REDACTED_PHONE]")
    .replace(/(?:token|secret|password|session|cookie|credential)\s*[:=]\s*\S+/gi, "[REDACTED_SECRET]")
    .replace(/authorization\s*[:=]?\s*(?:(?:bearer|basic|digest)\s+)?\S+/gi, "[REDACTED_SECRET]")
    .replace(/(?:bearer\s+|api[_ -]?key\s*[:=]?\s*)\S+/gi, "[REDACTED_SECRET]")
    .replace(/\b\d{17}[\dXx]\b/g, "[REDACTED_ID]")
    .replace(/\s+/g, " ").trim().slice(0, 512);
}
