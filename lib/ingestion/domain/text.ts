export const UTF8_TEXT_ENCODING = "UTF-8" as const;

export type TextEncoding = typeof UTF8_TEXT_ENCODING;

export type UnicodeNormalizationForm = "NFC" | "NFKC";

export const TEXT_NORMALIZATION_OPERATIONS = [
  "UNICODE_NORMALIZATION",
  "WIDTH_FOLDING",
  "PUNCTUATION_FOLDING",
  "WHITESPACE_FOLDING",
  "DATE_CANONICALIZATION",
  "EDUCATION_CANONICALIZATION",
  "MAJOR_CANONICALIZATION"
] as const;

export type TextNormalizationOperation =
  (typeof TEXT_NORMALIZATION_OPERATIONS)[number];

export interface OriginalText {
  readonly text: string;
  readonly encoding: TextEncoding;
}

export interface NormalizedText {
  readonly text: string;
  readonly unicode_form: UnicodeNormalizationForm;
  readonly normalizer_version: string;
  readonly operations: readonly TextNormalizationOperation[];
}

export interface TraceableText {
  readonly original: OriginalText;
  readonly normalized?: NormalizedText;
}
