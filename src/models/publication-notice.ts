import { cleanTitleText } from "./title-text";

const CORRECTION_PREFIX = /^(?:(?:corrigendum|erratum)\b(?:\s+(?:to|of))?|correction\s+to\b|correction\s*:)[\s:：]*/iu;

export function isCorrectionTitle(title: string): boolean {
  return CORRECTION_PREFIX.test(cleanTitleText(title));
}

export function correctionDisplayTitle(original: string, displayed: string): string | null {
  if (!isCorrectionTitle(original)) return null;
  let subject = cleanTitleText(displayed).replace(CORRECTION_PREFIX, "")
    .replace(/^(?:勘误|勘誤|更正|訂正)\s*[：:]\s*/u, "");
  const quoted = subject.match(/^[“"‘']([^]*)[”"’'](?:\s+\[[^]*\])?$/u);
  if (quoted?.[1]) subject = quoted[1];
  const characters = Array.from(subject);
  return characters.length > 140 ? `${characters.slice(0, 140).join("").trimEnd()}…` : subject;
}
