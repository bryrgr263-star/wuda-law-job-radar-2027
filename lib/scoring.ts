import { EXCLUDED_TERMS, TARGET_DIRECTIONS, UNIT_TYPE_WEIGHT } from "@/lib/constants";
import type { CrawlSource, NonLawRule } from "@/lib/types";

export function isExcluded(text: string) {
  return EXCLUDED_TERMS.some((term) => text.includes(term));
}

export function detectDirection(text: string) {
  return TARGET_DIRECTIONS.find((direction) => text.includes(direction)) ?? "综合管理";
}

export function detectNonLawRule(text: string): NonLawRule {
  const compact = text.replace(/\s+/g, "");
  if (/本硕(阶段)?均.{0,8}法学|本科.{0,8}法学.{0,16}硕士.{0,8}法学/.test(compact)) return "要求本硕均法学";
  if (/本科(阶段|专业)?.{0,10}(须|需|要求|为)法学/.test(compact)) return "要求本科法学";
  if (/法律硕士[（(]非法学[）)]|法硕[（(]?非法学|非法学背景.{0,6}法律硕士/.test(compact)) return "明确接受法律硕士（非法学）";
  if (/法学类|法律相关专业|法律硕士|法学硕士|法学相关/.test(compact)) return "可能接受";
  return "专业限制待核验";
}

export function calculateMatch(source: CrawlSource, title: string, body: string, rule: NonLawRule) {
  if (isExcluded(`${source.unit_name} ${source.industry} ${title} ${body}`)) return 0;
  if (["不接受", "要求本科法学", "要求本硕均法学"].includes(rule)) return 1;
  let score = UNIT_TYPE_WEIGHT[source.unit_type] ?? 3;
  const direction = detectDirection(`${title} ${body}`);
  if (["法务", "法律事务", "合规管理", "数据合规", "隐私保护", "商业合规"].includes(direction)) score += 1;
  if (rule === "明确接受法律硕士（非法学）") score += 1;
  if (rule === "专业限制待核验") score -= 1;
  return Math.max(1, Math.min(5, score));
}
