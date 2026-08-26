import { formatDate } from "../i18n";
import type { RssItem } from "../models/domain";
import type { RssReaderSettings } from "../models/settings";

export interface CardLayoutOptions {
  showMetadata: boolean;
  showAuthors: boolean;
  showAbstract: boolean;
  showGraphicalAbstract: boolean;
}

export interface CardPresentation {
  journal: string;
  publicationDate: string;
  doi: string;
  authors: string;
  abstract: string;
  imageUrl: string | null;
}

interface MetadataLabelMatch {
  label: string;
  start: number;
  end: number;
}

const METADATA_LABEL_PATTERN =
  /(Publication date|Published|Source|Journal|Author\(s\)|Authors?|DOI|出版日期|发布日期|来源|期刊|作者)\s*[:：]\s*/giu;

export function cardLayoutOptions(
  settings: RssReaderSettings,
): CardLayoutOptions {
  return {
    showMetadata:
      settings.cardShowJournal ||
      settings.cardShowPublicationDate ||
      settings.cardShowDoi,
    showAuthors: settings.cardShowAuthors,
    showAbstract: settings.cardShowAbstract,
    showGraphicalAbstract: settings.cardShowGraphicalAbstract,
  };
}

export function buildCardPresentation(
  item: RssItem,
  settings: RssReaderSettings,
): CardPresentation {
  return {
    journal: settings.cardShowJournal ? item.journal.trim() : "",
    publicationDate: settings.cardShowPublicationDate
      ? publicationDate(item)
      : "",
    doi: settings.cardShowDoi ? item.doi.trim() : "",
    authors: settings.cardShowAuthors ? item.authors.trim() : "",
    abstract: settings.cardShowAbstract ? displayAbstract(item) : "",
    imageUrl: settings.cardShowGraphicalAbstract ? item.imageUrl : null,
  };
}

export function displayAbstract(
  item: Pick<
    RssItem,
    "summary" | "journal" | "authors" | "doi" | "pubDate" | "year"
  >,
): string {
  const summary = item.summary.trim();
  if (!summary || isMetadataOnlySummary(summary, item)) {
    return "";
  }
  return summary;
}

function publicationDate(
  item: Pick<RssItem, "pubDate" | "year">,
): string {
  const formatted = item.pubDate
    ? formatDate(item.pubDate, { dateStyle: "medium" })
    : "";
  return formatted || item.year.trim();
}

function isMetadataOnlySummary(
  summary: string,
  item: Pick<RssItem, "journal" | "authors" | "doi" | "pubDate" | "year">,
): boolean {
  const matches = Array.from(
    summary.matchAll(METADATA_LABEL_PATTERN),
    (match): MetadataLabelMatch => ({
      label: match[1] ?? "",
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
  const first = matches[0];
  if (!first || summary.slice(0, first.start).trim()) {
    return false;
  }
  return matches.every((match, index) => {
    const next = matches[index + 1];
    const value = summary.slice(match.end, next?.start ?? summary.length).trim();
    return metadataValueMatches(match.label, value, item);
  });
}

function metadataValueMatches(
  label: string,
  value: string,
  item: Pick<RssItem, "journal" | "authors" | "doi" | "pubDate" | "year">,
): boolean {
  if (!value) {
    return false;
  }
  const normalizedLabel = label.toLocaleLowerCase();
  if (
    normalizedLabel === "publication date" ||
    normalizedLabel === "published" ||
    label === "\u51fa\u7248\u65e5\u671f" ||
    label === "\u53d1\u5e03\u65e5\u671f"
  ) {
    const year = item.year.trim();
    return Boolean(year && value.includes(year) && value.length <= 80);
  }
  if (
    normalizedLabel === "source" ||
    normalizedLabel === "journal" ||
    label === "\u6765\u6e90" ||
    label === "\u671f\u520a"
  ) {
    return journalValueMatches(value, item.journal);
  }
  if (
    normalizedLabel.startsWith("author") ||
    label === "\u4f5c\u8005"
  ) {
    return sameNamedValue(value, item.authors);
  }
  if (normalizedLabel === "doi") {
    const expected = normalizeDoi(item.doi);
    return Boolean(expected && normalizeDoi(value) === expected);
  }
  return false;
}

function journalValueMatches(value: string, journal: string): boolean {
  const normalizedValue = normalizeComparable(value);
  const normalizedJournal = normalizeComparable(journal);
  if (!normalizedJournal || !normalizedValue.startsWith(normalizedJournal)) {
    return false;
  }
  const suffix = normalizedValue.slice(normalizedJournal.length).trim();
  return (
    !suffix ||
    /^(?:vol(?:ume)?\.?|issue|no\.?|number|pages?|pp\.?)(?:\s|$).*$/i.test(
      suffix,
    )
  );
}

function sameNamedValue(value: string, expected: string): boolean {
  const normalizedExpected = normalizeComparable(expected);
  return Boolean(
    normalizedExpected &&
    normalizeComparable(value) === normalizedExpected,
  );
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[,;，；]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDoi(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:\s*/i, "")
    .replace(/[\s,;.]+$/g, "");
}
