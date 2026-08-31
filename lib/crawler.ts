import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { TARGET_DIRECTIONS } from "@/lib/constants";
import { calculateMatch, detectDirection, detectNonLawRule, isExcluded } from "@/lib/scoring";
import type { CrawlSource, Job, SourceStatus } from "@/lib/types";

const TARGET_ROLE_TERMS = [...TARGET_DIRECTIONS, "法治", "法规", "风控", "稽核"];
const GENERIC_TITLE_PATTERN = /(?:招贤纳士|人才招聘|招聘信息|招聘岗位|招聘公告|招聘首页|招聘系统|校园招聘首页|全部职位|职位列表|岗位列表|职位库|岗位库|资讯|请访问|查看岗位详情|投递简历|官方网站|(?:校招|校园招聘).*(?:面向|毕业时间|全球应届毕业生))/;
const JOB_CONTAINER_SELECTOR = "li, tr, article, section, [class*='job-item'], [class*='position-item'], [class*='content-item']";

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absoluteUrl(href: string, base: string) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

export function isSpecificJobTitle(value: string) {
  const title = cleanText(value).replace(/^[「『【\[]+|[」』】\]]+$/g, "");
  if (title.length < 3 || title.length > 120) return false;
  if (/^https?:\/\//i.test(title) || GENERIC_TITLE_PATTERN.test(title)) return false;
  if (/(?:职位|岗位)池/.test(title)) return false;
  return true;
}

export function isDirectJobUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const queryKeys = [...url.searchParams.keys()].map((key) => key.toLowerCase());
    if (/(?:^|\/)(?:index|list|recruiting)\.html?$/.test(path) || /\/(?:campus|recruit|jobs?)\/?$/.test(path)) return false;
    if (/\/(?:detail|post|position|positions|job|jobs|vacancy)(?:\/|$)/.test(path)) return true;
    if (/\/(?:news|content)\/\d+(?:\.html?)?$/.test(path) || /\/content\/id\/\d+/.test(path)) return true;
    return queryKeys.some((key) => ["jobadid", "jobid", "positionid", "position_id"].includes(key));
  } catch {
    return false;
  }
}

export function isPublishableJobLink(title: string, announcementUrl: string, applicationUrl: string | null) {
  return isSpecificJobTitle(title) && (isDirectJobUrl(applicationUrl) || isDirectJobUrl(announcementUrl));
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
  return /2027\s*(届|校园招聘|校招|年度)|招聘年度[：:]?\s*2027/.test(text);
}

function targetsRequestedRole(text: string) {
  return TARGET_ROLE_TERMS.some((term) => text.includes(term));
}

function titleFromContainer($: cheerio.CheerioAPI, container: ReturnType<cheerio.CheerioAPI>, fallback: string) {
  const titles = container
    .find("h1,h2,h3,h4,h5,h6,[class*='job-title'],[class*='position-title']")
    .map((_, element) => cleanText($(element).text()))
    .get();
  return titles.find(isSpecificJobTitle) ?? fallback;
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
  const candidates = new Map<string, { title: string; url: string; context: string; announcementUrl: string }>();

  $("a[href]").each((_, element) => {
    const anchorTitle = cleanText($(element).text() || $(element).attr("title") || "");
    const url = absoluteUrl($(element).attr("href") ?? "", source.url);
    if (!url) return;

    const container = $(element).closest(JOB_CONTAINER_SELECTOR).first();
    const rawContainerText = cleanText(container.text());
    const containerText = rawContainerText.slice(0, 14_000);
    const containerTitle = titleFromContainer($, container, anchorTitle);
    const combined = `${containerTitle} ${containerText}`;
    const containerUrls = new Set(
      container
        .find("a[href]")
        .map((_, link) => absoluteUrl($(link).attr("href") ?? "", source.url))
        .get()
        .filter((candidateUrl): candidateUrl is string => Boolean(candidateUrl))
    );
    const focusedContainer = rawContainerText.length <= 14_000 && containerUrls.size <= 4;
    if (focusedContainer && isSpecificJobTitle(containerTitle) && is2027(combined) && targetsRequestedRole(combined) && isDirectJobUrl(url)) {
      candidates.set(url, { title: containerTitle, url, context: containerText, announcementUrl: response.url });
      return;
    }

    const context = cleanText($(element).parent().text()).slice(0, 2000);
    const anchorCombined = `${anchorTitle} ${context}`;
    if (isSpecificJobTitle(anchorTitle) && is2027(anchorCombined) && targetsRequestedRole(anchorCombined) && isDirectJobUrl(url)) {
      candidates.set(url, { title: anchorTitle, url, context, announcementUrl: response.url });
    }
  });

  const pageContext = `${pageTitle} ${pageText.slice(0, 12_000)}`;
  if (isDirectJobUrl(response.url) && isSpecificJobTitle(pageTitle) && is2027(pageContext) && targetsRequestedRole(pageContext)) {
    candidates.set(response.url, { title: pageTitle, url: response.url, context: pageText.slice(0, 12_000), announcementUrl: response.url });
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
      announcement_url: candidate.announcementUrl,
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
      source_status: sourceStatus(source.url, source),
      source_name: source.name,
      source_updated_at: updatedAt,
      updated_at: updatedAt
    } satisfies Job];
  });
}
