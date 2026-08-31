import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { TARGET_DIRECTIONS } from "@/lib/constants";
import { calculateMatch, detectDirection, detectNonLawRule, isExcluded } from "@/lib/scoring";
import type { CrawlSource, Job, SourceStatus } from "@/lib/types";

const RECRUITMENT_TERMS = ["校园招聘", "应届生", "2027届", "2027校园", "招聘岗位", "招聘公告", "管培生"];

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absoluteUrl(href: string, base: string) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function deterministicId(source: CrawlSource, url: string, title: string) {
  const digest = createHash("sha256").update(`${source.unit_name}|${url}|${title}`).digest("hex").slice(0, 12).toUpperCase();
  const unit = source.unit_name.replace(/[（）()有限公司集团股份\s]/g, "").slice(0, 8);
  return `2027-${unit}-${digest}`;
}

function parseDateValue(raw: string) {
  const match = raw.match(/(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function detectDeadline(text: string) {
  const context = text.match(/(?:截止|报名至|网申至|投递至|结束时间)[：:\s]*([^，。；;\n]{0,28})/);
  return context ? parseDateValue(context[1]) : null;
}

function detectStartDate(text: string) {
  const context = text.match(/(?:开始时间|报名时间|网申时间)[：:\s]*([^，。；;\n]{0,28})/);
  return context ? parseDateValue(context[1]) : null;
}

function detectLocation(text: string) {
  const cities = ["北京", "上海", "深圳", "广州", "武汉", "杭州", "南京", "成都", "重庆", "天津", "西安", "长沙", "苏州", "厦门", "青岛", "全国"];
  return cities.filter((city) => text.includes(city)).slice(0, 4).join("、") || "全国/未注明";
}

function sourceStatus(url: string, source: CrawlSource): SourceStatus {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === source.official_domain || host.endsWith(`.${source.official_domain}`) ? "官方来源" : "来源待核验";
  } catch {
    return "来源待核验";
  }
}

function is2027(text: string) {
  return /2027\s*届|2027\s*校园招聘|招聘年度[：:]?\s*2027/.test(text);
}

function relevant(text: string) {
  return TARGET_DIRECTIONS.some((term) => text.includes(term)) || RECRUITMENT_TERMS.some((term) => text.includes(term));
}

export async function crawlSource(source: CrawlSource): Promise<Job[]> {
  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WudaLawJobRadar/1.0; public recruitment monitor)",
      "Accept-Language": "zh-CN,zh;q=0.9"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();

  const pageText = cleanText($("body").text()).slice(0, 180_000);
  const pageTitle = cleanText($("h1").first().text() || $("title").text());
  const candidates = new Map<string, { title: string; url: string; context: string }>();

  $("a[href]").each((_, element) => {
    const title = cleanText($(element).text() || $(element).attr("title") || "");
    const url = absoluteUrl($(element).attr("href") ?? "", source.url);
    if (!url || title.length < 2) return;
    const context = cleanText($(element).parent().text()).slice(0, 1500);
    const combined = `${title} ${context}`;
    if (is2027(combined) && relevant(combined)) candidates.set(url, { title, url, context });
  });

  if (is2027(`${pageTitle} ${pageText.slice(0, 8000)}`) && relevant(`${pageTitle} ${pageText}`)) {
    candidates.set(response.url, { title: pageTitle || `${source.unit_name}2027届校园招聘`, url: response.url, context: pageText.slice(0, 12_000) });
  }

  return [...candidates.values()].flatMap((candidate) => {
    const body = `${candidate.title} ${candidate.context}`;
    if (isExcluded(`${source.unit_name} ${source.industry} ${body}`)) return [];
    const nonLawRule = detectNonLawRule(body);
    const matchScore = calculateMatch(source, candidate.title, body, nonLawRule);
    if (matchScore === 0) return [];
    const deadline = detectDeadline(body);
    const now = new Date();
    const status = deadline && new Date(`${deadline}T23:59:59+08:00`) < now ? "已截止" : "网申进行中";
    const updatedAt = new Date().toISOString();
    return [{
      id: deterministicId(source, candidate.url, candidate.title),
      job_id: deterministicId(source, candidate.url, candidate.title),
      announcement_url: candidate.url,
      application_url: candidate.url,
      unit_name: source.unit_name,
      unit_type: source.unit_type,
      system_name: source.system_name,
      industry: source.industry,
      location: detectLocation(body),
      title: candidate.title.slice(0, 240),
      direction: detectDirection(body),
      recruitment_year: 2027,
      batch: /秋招|秋季/.test(body) ? "秋季校园招聘" : /春招|春季/.test(body) ? "春季校园招聘" : "校园招聘",
      education: /博士/.test(body) ? "硕士及以上" : /硕士|研究生/.test(body) ? "硕士研究生" : "学历要求待核验",
      non_law_rule: nonLawRule,
      match_score: matchScore,
      salary: "未公开",
      development: detectDirection(body),
      start_date: detectStartDate(body),
      deadline,
      recruitment_status: status,
      source_status: sourceStatus(candidate.url, source),
      source_name: source.name,
      source_updated_at: updatedAt,
      updated_at: updatedAt
    } satisfies Job];
  });
}
