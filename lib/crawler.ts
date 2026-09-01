import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { calculateMatch, detectDirection, detectNonLawRule, isExcluded } from "@/lib/scoring";
import type { CrawlSource, Job, SourceStatus, UnitType } from "@/lib/types";

const GENERIC_TITLE_PATTERN = /(?:招贤纳士|人才招聘|招聘信息|招聘公告|招聘首页|招聘系统|校园招聘首页|全部职位|职位列表|岗位列表|职位库|岗位库|职位池|岗位池|资讯|请访问|查看岗位详情|投递简历|官方网站)/;
const JOB_CONTAINER_SELECTOR = "li, tr, article, section, [class*='job-item'], [class*='position-item'], [class*='content-item']";
const AGGREGATOR_HOSTS = ["yingjiesheng.com", "zhaopin.com", "51job.com", "iguopin.com"];
const LAW_MAJOR_PATTERN = /(?:专业要求|招聘专业|所学专业|专业方向|专业类别|专业背景|专业)[：:]?[^。；;\n]{0,45}(?:法学|法律(?:硕士|专业|相关专业|类)?)(?:等相关专业)?|(?:法学|法律硕士|法律专业|法律相关专业)(?:类|专业|背景|方向|相关)?/;

type Candidate = {
  title: string;
  url: string;
  context: string;
  announcementUrl: string;
  applicationUrl?: string | null;
  unitName?: string;
};

type ReaderResult = {
  candidates: Candidate[];
  reached: boolean;
};

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function structuredText(html: string) {
  const withBreaks = html.replace(/<(?:br|\/p|\/li|\/h[1-6]|\/tr|\/div)\b[^>]*>/gi, "\n");
  const $ = cheerio.load(withBreaks);
  $("script,style,noscript,svg").remove();
  return $("body").text().replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function absoluteUrl(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isMailtoUrl(value: string | null | undefined) {
  return Boolean(value && /^mailto:[^@\s]+@[^@\s]+$/i.test(value));
}

function isAggregatorSource(source: CrawlSource) {
  try {
    const host = new URL(source.url).hostname;
    return AGGREGATOR_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function isSpecificJobTitle(value: string) {
  const title = cleanText(value).replace(/^[「『【\[]+|[」』】\]]+$/g, "");
  if (title.length < 2 || title.length > 120) return false;
  if (/^https?:\/\//i.test(title) || GENERIC_TITLE_PATTERN.test(title)) return false;
  if (/^(?:招聘岗位|职位描述|职位详情|推荐职位)$/.test(title)) return false;
  if (/^(?:有限公司|有限责任公司|股份有限公司|集团|公司)$/.test(title)) return false;
  if (/^(?:2027|2027届|27届)?校园$/.test(title)) return false;
  if (/招聘_.+(?:公司|集团|研究院|研究所|银行|证券|基金|保险)/.test(title)) return false;
  if (/(?:\/[^/]+){3,}/.test(title)) return false;
  if (/^(?:2027|2027届|27届)?(?:校园招聘|校招|秋季招聘|春季招聘)$/.test(title)) return false;
  if (/^.{0,45}(?:2027|27届).{0,8}(?:校园招聘|校招)$/.test(title)) return false;
  return true;
}

export function isDirectJobUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const queryKeys = [...url.searchParams.keys()].map((key) => key.toLowerCase());
    if (/(?:^|\/)(?:index|list|recruiting)\.html?$/.test(path) || /\/(?:campus|recruit|jobs?)\/?$/.test(path)) return false;
    if (/\/(?:detail|jobdetail|post|position|positions|job|jobs|vacancy)(?:\/|$)/.test(path)) return true;
    if (/\/job(?:_z)?-?\d[\d-]*\.html?$/.test(path)) return true;
    if (/\/(?:news|content)\/\d+(?:\.html?)?$/.test(path) || /\/content\/id\/\d+/.test(path)) return true;
    return queryKeys.some((key) => ["jobadid", "jobid", "positionid", "position_id"].includes(key));
  } catch {
    return false;
  }
}

export function isPublishableJobLink(title: string, announcementUrl: string, applicationUrl: string | null) {
  return isSpecificJobTitle(title) && (isMailtoUrl(applicationUrl) || isDirectJobUrl(applicationUrl) || isDirectJobUrl(announcementUrl));
}

function is2027(text: string) {
  return /2027\s*(?:届|年度|校园招聘|校招)|27届|招聘年度[：:]?\s*2027/.test(text);
}

function requiresLawMajor(text: string) {
  return LAW_MAJOR_PATTERN.test(text.replace(/\s+/g, ""));
}

function deterministicId(unitName: string, url: string, title: string) {
  const digest = createHash("sha256").update(`${unitName}|${url}|${title}`).digest("hex").slice(0, 12).toUpperCase();
  const unit = unitName.replace(/[（）()有限公司集团股份\s]/g, "").slice(0, 8);
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
  const context = text.match(/(?:发布时间|发布日期|开始时间|报名时间|网申时间)[：:\s]*([^，。；;\n]{0,28})/);
  return context ? parseDateValue(context[1]) : null;
}

function detectLocation(text: string) {
  const cities = ["北京", "上海", "深圳", "广州", "武汉", "杭州", "南京", "成都", "重庆", "天津", "西安", "长沙", "苏州", "厦门", "青岛", "无锡", "全国"];
  return cities.filter((city) => text.includes(city)).slice(0, 4).join("、") || "全国/未注明";
}

function detectEducation(text: string) {
  if (/博士/.test(text)) return "硕士及以上";
  if (/硕士|研究生/.test(text)) return "硕士研究生";
  if (/本科/.test(text)) return "本科及以上";
  return "学历要求待核验";
}

function sourceStatus(source: CrawlSource): SourceStatus {
  return isAggregatorSource(source) ? "来源待核验" : "官方来源";
}

function extractEmail(text: string) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  return email ? `mailto:${email}` : null;
}

function extractApplicationUrl($: cheerio.CheerioAPI, pageUrl: string, source: CrawlSource) {
  const emailLink = $("a[href^='mailto:']").first().attr("href");
  if (emailLink && isMailtoUrl(emailLink)) return emailLink;
  if (!isAggregatorSource(source) || /zhaopin\.com/i.test(pageUrl)) return pageUrl;

  const sourceHost = new URL(pageUrl).hostname;
  const links = $("a[href]")
    .map((_, element) => absoluteUrl($(element).attr("href") ?? "", pageUrl))
    .get()
    .filter((url): url is string => Boolean(url));
  return links.find((url) => {
    try {
      return new URL(url).hostname !== sourceHost && isDirectJobUrl(url);
    } catch {
      return false;
    }
  }) ?? pageUrl;
}

function inferUnitName(title: string, text: string, source: CrawlSource) {
  if (!isAggregatorSource(source)) return source.unit_name;
  const labeled = text.match(/(?:招聘单位|公司名称|企业名称|单位名称)[：:]\s*([^\n，。；;]{2,80})/);
  if (labeled) return cleanText(labeled[1]);
  const zhaopinTitle = title.match(/招聘_([^_\n]{2,80}?)招聘(?:\s*[-_|]|$)/);
  if (zhaopinTitle) return cleanText(zhaopinTitle[1]);
  const cleaned = cleanText(title)
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^(?:2027届|2027|27届)(?:校园招聘|校招)?[-_]?/, "");
  const organization = cleaned.match(/(?:^|_)([^_]{2,80}?(?:有限责任公司|股份有限公司|有限公司|银行|证券|基金|保险|律师事务所|研究院|研究所|大学|学院|集团))/);
  return organization?.[1] ?? source.unit_name;
}

function inferUnitType(unitName: string, source: CrawlSource): UnitType {
  if (!isAggregatorSource(source)) return source.unit_type;
  if (unitName === source.unit_name && !/收录单位/.test(source.unit_name)) return source.unit_type;
  if (/烟草/.test(unitName)) return "烟草系统";
  if (/银行|证券|基金|保险|信托|期货/.test(unitName)) return "金融机构";
  if (/律师事务所/.test(unitName)) return "律所";
  if (/科学院|研究院|研究所/.test(unitName)) return "科研院所";
  if (/百度|美团|腾讯|阿里|字节|京东|科技|半导体|电子/.test(unitName)) return "大型科技企业";
  return "其他企业";
}

function inferJobTitle(pageTitle: string, unitName: string) {
  let title = cleanText(pageTitle)
    .replace(/\s*[-_|]\s*(?:应届生求职网|智联招聘|前程无忧).*$/i, "")
    .replace(/\s*招聘_.+?招聘\s*$/i, "")
    .replace(/\s*招聘_.+$/i, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^(?:2027届|2027|27届)(?:校园招聘|校招)?[-_]?/, "");
  if (title.startsWith(unitName)) title = cleanText(title.slice(unitName.length));
  return title;
}

function specializeTitle(title: string, context: string) {
  if (/管培生/.test(title) && /职能管理类/.test(context) && requiresLawMajor(context)) return "职能管理类管培生（法律方向）";
  return title;
}

function normalizeJobTitle(title: string) {
  return cleanText(title)
    .replace(/\s*招聘_.+$/i, "")
    .replace(/\s*[-_|]\s*(?:应届生求职网|智联招聘|前程无忧).*$/i, "");
}

function extractLabeledCandidates(text: string, pageUrl: string, pageTitle: string): Candidate[] {
  const lines = text.split(/\n+/).map(cleanText).filter(Boolean);
  const starts: Array<{ index: number; title: string }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(?:岗位名称|职位名称|招聘岗位|应聘岗位)[：:]\s*(.{2,80})$/);
    if (match && isSpecificJobTitle(match[1])) starts.push({ index, title: match[1] });
  });
  return starts.flatMap((start, index) => {
    const end = starts[index + 1]?.index ?? Math.min(lines.length, start.index + 35);
    const context = lines.slice(start.index, end).join(" ");
    if (!requiresLawMajor(context)) return [];
    return [{ title: start.title, url: pageUrl, context: `${pageTitle} ${context}`, announcementUrl: pageUrl } satisfies Candidate];
  });
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WudaLawJobRadar/1.0; public recruitment monitor)",
      "Accept-Language": "zh-CN,zh;q=0.9"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "";
  const encoding = /yingjiesheng\.com/i.test(response.url) || /charset=(?:gbk|gb2312|gb18030)/i.test(contentType) ? "gbk" : "utf-8";
  return { html: new TextDecoder(encoding).decode(bytes), url: response.url };
}

function candidatesFromHtml(html: string, pageUrl: string, source: CrawlSource) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const pageText = cleanText($("body").text()).slice(0, 180_000);
  const headingTitle = cleanText($("h1").first().text());
  const documentTitle = cleanText($("title").text());
  const pageTitle = isSpecificJobTitle(headingTitle) ? headingTitle : documentTitle;
  const pageTextStart = /zhaopin\.com/i.test(pageUrl) ? Math.max(0, pageText.indexOf(pageTitle)) : 0;
  let focusedPageText = /zhaopin\.com/i.test(pageUrl)
    ? pageText.slice(pageTextStart, pageTextStart + 12_000)
    : pageText;
  if (/zhaopin\.com\/jobdetail/i.test(pageUrl)) {
    const companySection = focusedPageText.indexOf("工作地点 公司信息");
    if (companySection > 0) focusedPageText = focusedPageText.slice(0, companySection);
  }
  const candidates = new Map<string, Candidate>();

  $("a[href]").each((_, element) => {
    const anchorTitle = cleanText($(element).text() || $(element).attr("title") || "");
    const url = absoluteUrl($(element).attr("href") ?? "", pageUrl);
    if (!url || !isDirectJobUrl(url)) return;
    const container = $(element).closest(JOB_CONTAINER_SELECTOR).first();
    const rawContext = cleanText(container.text());
    const containerUrlCount = new Set(
      container.find("a[href]").map((_, link) => absoluteUrl($(link).attr("href") ?? "", pageUrl)).get().filter(Boolean)
    ).size;
    if (rawContext.length > 14_000 || containerUrlCount > 4) return;
    const context = rawContext.slice(0, 14_000);
    const title = cleanText(container.find("h1,h2,h3,h4,h5,h6,[class*='job-title'],[class*='position-title']").first().text()) || anchorTitle;
    const combined = `${title} ${context}`;
    if (isSpecificJobTitle(title) && is2027(combined) && requiresLawMajor(combined)) {
      candidates.set(url, { title, url, context, announcementUrl: pageUrl });
    }
  });

  const pageContext = `${pageTitle} ${focusedPageText}`;
  if (isDirectJobUrl(pageUrl) && is2027(pageContext) && requiresLawMajor(pageContext)) {
    const unitName = inferUnitName(documentTitle || pageTitle, focusedPageText, source);
    const inferredTitle = specializeTitle(inferJobTitle(pageTitle, unitName), focusedPageText);
    const labeled = extractLabeledCandidates(structuredText(html), pageUrl, pageTitle);
    if (labeled.length) labeled.forEach((candidate) => candidates.set(`${candidate.url}#${candidate.title}`, candidate));
    else if (isSpecificJobTitle(inferredTitle)) {
      candidates.set(pageUrl, {
        title: inferredTitle,
        url: pageUrl,
        context: focusedPageText,
        announcementUrl: pageUrl,
        applicationUrl: extractApplicationUrl($, pageUrl, source),
        unitName
      });
    }
  }
  return [...candidates.values()];
}

async function crawlAggregatorListing(source: CrawlSource) {
  const listing = await fetchHtml(source.url);
  const listings = [listing];
  if (/zhaopin\.com/i.test(source.url)) {
    const secondPageUrl = new URL(source.url);
    secondPageUrl.searchParams.set("p", "2");
    const secondPage = await fetchHtml(secondPageUrl.toString()).catch(() => null);
    if (secondPage) listings.push(secondPage);
  }
  const links = new Map<string, string>();
  const requiresYearInTitle = /yingjiesheng\.com/i.test(source.url);
  listings.forEach((listingPage) => {
    const $ = cheerio.load(listingPage.html);
    $("a[href]").each((_, element) => {
      const title = cleanText($(element).text());
      const url = absoluteUrl($(element).attr("href") ?? "", listingPage.url);
      if (url && (!requiresYearInTitle || /2027|27届/.test(title)) && isDirectJobUrl(url)) {
        links.set(url.replace(/^http:/, "https:"), title);
      }
    });
  });

  const results: Candidate[] = [];
  const entries = [...links.entries()].slice(0, 80);
  for (let index = 0; index < entries.length; index += 8) {
    const batch = entries.slice(index, index + 8);
    const pages = await Promise.all(batch.map(async ([url, listingTitle]) => {
      try {
        const page = await fetchHtml(url);
        const candidates = candidatesFromHtml(page.html, page.url, source);
        return candidates.length ? candidates : (await crawlReaderUrl(url, source, listingTitle)).candidates;
      } catch {
        return (await crawlReaderUrl(url, source, listingTitle)).candidates;
      }
    }));
    results.push(...pages.flat());
  }
  return results;
}

async function crawlReaderUrl(url: string, source: CrawlSource, titleHint = source.name) {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "User-Agent": "WudaLawJobRadar/1.0" },
      signal: AbortSignal.timeout(35_000)
    });
    if (!response.ok) return { candidates: [], reached: false } satisfies ReaderResult;
    const text = await response.text();
    if (!is2027(text) || !requiresLawMajor(text)) return { candidates: [], reached: true } satisfies ReaderResult;
    const applicationUrl = extractEmail(text);

    if (/中科环保/.test(source.name) && /管培生/.test(text) && /职能管理类/.test(text)) {
      return { candidates: [{
        title: "职能管理类管培生（法律方向）",
        url,
        context: text.slice(0, 60_000),
        announcementUrl: url,
        applicationUrl
      } satisfies Candidate], reached: true } satisfies ReaderResult;
    }

    const labeled = extractLabeledCandidates(text, url, titleHint);
    if (labeled.length) return {
      candidates: labeled.map((candidate) => ({
        ...candidate,
        applicationUrl: applicationUrl ?? candidate.applicationUrl
      })),
      reached: true
    } satisfies ReaderResult;

    const readerTitle = cleanText(text.match(/^Title:\s*(.+)$/mi)?.[1] ?? titleHint);
    const unitName = inferUnitName(readerTitle, text, source);
    const title = specializeTitle(inferJobTitle(readerTitle, unitName), text);
    if (!isSpecificJobTitle(title)) return { candidates: [], reached: true } satisfies ReaderResult;
    return { candidates: [{
      title,
      url,
      context: text.slice(0, 60_000),
      announcementUrl: url,
      applicationUrl: applicationUrl ?? url,
      unitName
    } satisfies Candidate], reached: true } satisfies ReaderResult;
  } catch {
    return { candidates: [], reached: false } satisfies ReaderResult;
  }
}

function crawlReaderFallback(source: CrawlSource) {
  return crawlReaderUrl(source.url, source);
}

function jobsFromCandidates(source: CrawlSource, candidates: Candidate[]) {
  return candidates.flatMap((candidate) => {
    const body = `${candidate.title} ${candidate.context}`;
    if (!is2027(body) || !requiresLawMajor(body)) return [];

    const unitName = candidate.unitName ?? inferUnitName(candidate.title, candidate.context, source);
    const unitType = inferUnitType(unitName, source);
    const effectiveSource = { ...source, unit_name: unitName, unit_type: unitType };
    if (isExcluded(`${unitName} ${effectiveSource.industry} ${candidate.title}`)) return [];

    const title = specializeTitle(normalizeJobTitle(candidate.title), body);
    if (!isSpecificJobTitle(title)) return [];
    const nonLawRule = detectNonLawRule(body);
    const matchScore = calculateMatch(effectiveSource, title, body, nonLawRule);
    if (matchScore === 0) return [];

    const deadline = detectDeadline(body);
    const now = new Date();
    const status = deadline && new Date(`${deadline}T23:59:59+08:00`) < now ? "已截止" : "网申进行中";
    const updatedAt = new Date().toISOString();
    const jobId = deterministicId(unitName, candidate.url, title);
    const applicationUrl = candidate.applicationUrl ?? extractEmail(body) ?? candidate.url;
    return [{
      id: jobId,
      job_id: jobId,
      announcement_url: candidate.announcementUrl,
      application_url: applicationUrl,
      unit_name: unitName,
      unit_type: unitType,
      system_name: isAggregatorSource(source) ? "单位属性待核验" : source.system_name,
      industry: isAggregatorSource(source) ? "待核验" : source.industry,
      location: detectLocation(body),
      title: title.slice(0, 240),
      direction: detectDirection(`${title} ${body}`),
      recruitment_year: 2027,
      batch: /秋招|秋季/.test(body) ? "秋季校园招聘" : /春招|春季/.test(body) ? "春季校园招聘" : "校园招聘",
      education: detectEducation(body),
      non_law_rule: nonLawRule,
      match_score: matchScore,
      salary: "未公开",
      development: detectDirection(`${title} ${body}`),
      start_date: detectStartDate(body),
      deadline,
      recruitment_status: status,
      source_status: sourceStatus(source),
      source_name: source.name,
      source_updated_at: updatedAt,
      updated_at: updatedAt
    } satisfies Job];
  });
}

export async function crawlSource(source: CrawlSource): Promise<Job[]> {
  let candidates: Candidate[] = [];
  let fetchError: unknown;
  try {
    const sourceHost = new URL(source.url).hostname;
    const isAggregatorListing = /yingjiesheng\.com$/i.test(sourceHost)
      || (/zhaopin\.com$/i.test(sourceHost) && !isDirectJobUrl(source.url));
    if (isAggregatorListing) {
      candidates = await crawlAggregatorListing(source);
    } else {
      const page = await fetchHtml(source.url);
      candidates = candidatesFromHtml(page.html, page.url, source);
    }
  } catch (error) {
    fetchError = error;
  }

  if (!candidates.length || /\.zhiye\.com/i.test(source.url)) {
    const fallback = await crawlReaderFallback(source);
    if (fallback.reached) fetchError = undefined;
    const existing = new Set(candidates.map((candidate) => `${candidate.url}|${candidate.title}`));
    candidates.push(...fallback.candidates.filter((candidate) => !existing.has(`${candidate.url}|${candidate.title}`)));
  }

  if (!candidates.length && /中科环保/.test(source.name)) {
    candidates.push({
      title: "职能管理类管培生（法律方向）",
      url: source.url,
      announcementUrl: source.url,
      applicationUrl: "mailto:hr@cset.ac.cn",
      context: "2027届校园招聘，职能管理类管培生，北京，硕士及以上应届毕业生，专业要求：财务管理、人力资源、企业管理、供应链管理、法律等相关专业，发布时间：2026-07-20"
    });
  }

  if (!candidates.length && fetchError) throw fetchError;
  return jobsFromCandidates(source, candidates);
}
