import { load } from "cheerio";
import { canonicalHash } from "../../ingestion/normalization/canonical-artifact-registry";
import { safeDiscoveryText, safeDiscoveryUrl } from "../safety";

export function observeDirectory(body: string, publisherUrl: string, maximum: number) {
  const document = load(body);
  document("script,style,noscript,template").remove();
  const observations: { url: string | null; url_hash: string; quote: string; locator: string; status: string }[] = [];
  const seen = new Set<string>();
  document("a[href]").each((index, element) => {
    const raw = document(element).attr("href")!;
    const quote = safeDiscoveryText(document(element).text());
    if (!quote) return;
    let url: string | null = null;
    let status = "UNVISITED_FRONTIER";
    try { url = safeDiscoveryUrl(new URL(raw, publisherUrl).href); }
    catch { status = "UNSAFE_URL_NOT_VISITED"; }
    const key = canonicalHash({ url_hash: canonicalHash(url ?? raw), quote });
    if (seen.has(key)) return;
    seen.add(key);
    observations.push({ url, url_hash: canonicalHash(url ?? raw), quote, locator: `a[href]:ordinal:${index + 1}`, status });
  });
  return { selected: observations.slice(0, maximum), deferred: observations.slice(maximum),
    content_hash: canonicalHash(body) };
}
