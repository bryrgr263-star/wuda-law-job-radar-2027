import {
  UTF8_TEXT_ENCODING,
  type IsoDate,
  type NormalizedText,
  type OriginalText,
  type TraceableText
} from "../domain";

export const SOURCE_NORMALIZER_VERSION = "source-normalizer/1.0.0";

const punctuationMap: Readonly<Record<string, string>> = {
  "（": "(",
  "）": ")",
  "：": ":",
  "；": ";",
  "，": ",",
  "！": "!",
  "？": "?"
};

const municipalityAliases: Readonly<Record<string, string>> = {
  北京市: "北京",
  北京: "北京",
  上海市: "上海",
  上海: "上海",
  天津市: "天津",
  天津: "天津",
  重庆市: "重庆",
  重庆: "重庆"
};

export function normalizeTraceableText(value: OriginalText): TraceableText {
  return {
    original: value,
    normalized: normalizedText(normalizeStableText(value.text))
  };
}

export function normalizeStableText(value: string) {
  const unicodeNormalized = value.normalize("NFKC");
  const punctuationNormalized = [...unicodeNormalized]
    .map((character) => punctuationMap[character] ?? character)
    .join("");
  return punctuationNormalized.replace(/\s+/gu, " ").trim();
}

export function normalizeLocationName(value: string) {
  const compact = normalizeStableText(value).replace(/\s+/gu, "");
  return municipalityAliases[compact] ?? compact;
}

export function normalizeUrl(value: string) {
  const parsed = new URL(normalizeStableText(value));
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/$/, "");
  const parameters = [...parsed.searchParams.entries()]
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      return leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue);
    });
  parsed.search = "";
  for (const [name, parameterValue] of parameters) {
    parsed.searchParams.append(name, parameterValue);
  }
  return parsed.toString();
}

export function parseDeterministicDate(value: OriginalText | undefined) {
  if (!value) return undefined;
  const normalized = normalizeStableText(value.text);
  const match = normalized.match(/(?<!\d)(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?!\d)/);
  if (!match) return undefined;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return date as IsoDate;
}

export function parseRecruitmentYear(value: OriginalText | undefined) {
  if (!value) return undefined;
  const match = normalizeStableText(value.text).match(/(?<!\d)(20\d{2})(?!\d)/);
  return match ? Number(match[1]) : undefined;
}

export function originalText(value: string): OriginalText {
  return { text: value, encoding: UTF8_TEXT_ENCODING };
}

function normalizedText(value: string): NormalizedText {
  return {
    text: value,
    unicode_form: "NFKC",
    normalizer_version: SOURCE_NORMALIZER_VERSION,
    operations: [
      "UNICODE_NORMALIZATION",
      "WIDTH_FOLDING",
      "PUNCTUATION_FOLDING",
      "WHITESPACE_FOLDING"
    ]
  };
}
