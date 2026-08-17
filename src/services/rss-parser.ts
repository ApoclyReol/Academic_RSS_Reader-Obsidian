import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

import { t } from "../i18n";
import type { ParsedItem } from "../models/domain";

interface XmlNode {
  [key: string]: unknown;
}

export interface ParsedFeed {
  title: string;
  items: ParsedItem[];
}

export const MAX_FEED_XML_BYTES = 10 * 1024 * 1024;

const TRACKING_QUERY_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dgcid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
]);

const ITEM_CONTENT_FIELDS = [
  "summary",
  "description",
  "content",
  "content:encoded",
] as const;
const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i;
const DECORATIVE_IMAGE_HINT =
  /\b(?:advertisement|avatar|favicon|icon|logo|pixel|spacer|tracking)\b/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  textNodeName: "#text",
  trimValues: true,
  processEntities: true,
});
const xmlValidator = new SyntaxValidator({ multipleRoots: false });
export function parseFeed(
  xml: string,
  fallbackName: string,
  fallbackJournal = fallbackName,
): ParsedFeed {
  validateFeedXml(xml);
  let document: XmlNode;
  try {
    document = parser.parse(xml) as XmlNode;
  } catch (error) {
    throw new Error(t("feed.invalid_xml", {
      error: error instanceof Error ? error.message : String(error),
    }));
  }
  const rss = objectValue(document.rss);
  const rssChannel = objectValue(rss.channel);
  const rdf = objectValue(document["rdf:RDF"]);
  const rdfChannel = objectValue(rdf.channel);
  const atomFeed = objectValue(document.feed);
  const isRss = Object.prototype.hasOwnProperty.call(document, "rss") &&
    Object.prototype.hasOwnProperty.call(rss, "channel");
  const isRdf = Object.prototype.hasOwnProperty.call(document, "rdf:RDF") &&
    Object.prototype.hasOwnProperty.call(rdf, "channel");
  const isAtom = Object.prototype.hasOwnProperty.call(document, "feed");
  if (!isRss && !isRdf && !isAtom) {
    throw new Error(t("feed.invalid_root"));
  }
  const channel = isRss ? rssChannel : isRdf ? rdfChannel : atomFeed;
  const rawEntries = isRss
    ? arrayValue(channel.item)
    : isRdf
      ? arrayValue(rdf.item)
      : arrayValue(channel.entry);
  const title = textValue(channel.title) || fallbackName;

  return {
    title,
    items: rawEntries
      .map((entry) =>
        entryToItem(objectValue(entry), fallbackName, fallbackJournal),
      )
      .filter((item) => Boolean(item.title)),
  };
}

export function validateFeedXml(xml: string): void {
  if (utf8ByteLength(xml) > MAX_FEED_XML_BYTES) {
    throw new Error(t("feed.response_too_large"));
  }
  if (/<!DOCTYPE\b/i.test(xml)) {
    throw new Error(t("feed.doctype_rejected"));
  }
  try {
    xmlValidator.validate(xml);
  } catch (error) {
    throw new Error(t("feed.invalid_xml", {
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(value: string): string {
  return stripHtml(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, "")
    .replace(
      /[\u3000\s\-—–_·,，.。:：;；!！?？'‘’"“”()（）【】{}《》<>/\\|]+/gu,
      "",
    )
    .replace(/[[\]]+/gu, "");
}

export function canonicalizeLink(value: string): string {
  const link = value.trim();
  if (!link) {
    return "";
  }
  try {
    const url = new URL(link);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    url.hash = "";
    for (const parameter of [...url.searchParams.keys()]) {
      if (
        parameter.toLocaleLowerCase().startsWith("utm_") ||
        TRACKING_QUERY_PARAMETERS.has(parameter.toLocaleLowerCase())
      ) {
        url.searchParams.delete(parameter);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function findDoi(...values: string[]): string {
  const match = values
    .join(" ")
    .match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match?.[0]?.replace(/[.,;)\]]+$/, "").toLocaleLowerCase() ?? "";
}

export function publisherIdentity(value: string): string {
  const link = value.trim();
  if (!link) {
    return "";
  }
  try {
    const url = new URL(link);
    const hostname = url.hostname.toLocaleLowerCase();
    if (
      hostname === "sciencedirect.com" ||
      hostname.endsWith(".sciencedirect.com")
    ) {
      const match = url.pathname.match(/\/pii\/([^/]+)/i);
      if (match?.[1]) {
        return `sciencedirect-pii:${decodeURIComponent(match[1]).toLocaleUpperCase()}`;
      }
    }
    return "";
  } catch {
    return "";
  }
}

export function stableGuid(input: {
  title: string;
  journal: string;
  year: string;
  authors: string;
  doi: string;
  link?: string;
}): string {
  const doi = input.doi.trim().toLocaleLowerCase().replace(/^doi:\s*/i, "");
  if (doi) {
    return `doi:${doi}`;
  }
  const title = normalizeText(input.title);
  const author = normalizeText(input.authors).slice(0, 48);
  const publisherId = publisherIdentity(input.link ?? "");
  const identity = author
    ? [title, input.year || "", author]
    : publisherId
      ? [publisherId]
    : [title, input.year || "", normalizeText(input.journal)];
  const digest = createHash("sha256")
    .update(identity.join("|"))
    .digest("hex")
    .slice(0, 24);
  return `${publisherId && !author ? "publisher" : "cnki-local"}:${digest}`;
}

function entryToItem(
  entry: XmlNode,
  feedName: string,
  fallbackJournal: string,
): ParsedItem {
  const title = textValue(entry.title);
  const contentValues = ITEM_CONTENT_FIELDS.map((field) => entry[field]);
  const imageUrl = extractImageUrl(entry, contentValues);
  const rawSummary = firstText(...contentValues);
  const summary = stripHtml(rawSummary);
  const link = canonicalizeLink(extractLink(entry));
  const journal = extractJournal(entry, summary);
  const authors = extractAuthors(entry, summary);
  const pubDate = parseDate(
    firstText(
      entry.pubDate,
      entry.published,
      entry.updated,
      entry.date,
      entry["dc:date"],
    ),
  );
  const year = pubDate.slice(0, 4) || inferYear(title, summary);
  const doi = findDoi(
    title,
    firstText(entry.doi, entry["dc:identifier"], entry.id, entry.guid),
    link,
    summary,
  );
  return {
    stableGuid: stableGuid({
      title,
      journal: journal || fallbackJournal.trim() || feedName.trim(),
      year,
      authors,
      doi,
      link,
    }),
    title,
    titleNorm: normalizeText(title),
    authors,
    journal: journal || fallbackJournal.trim() || feedName.trim(),
    articleJournal: journal,
    year,
    doi,
    link,
    pubDate,
    summary,
    imageUrl: imageUrl || undefined,
  };
}

function extractImageUrl(
  entry: XmlNode,
  contentValues: unknown[],
): string {
  const mediaContent = firstStructuredImageUrl(
    entry["media:content"],
    false,
  );
  if (mediaContent) {
    return mediaContent;
  }
  const mediaThumbnail = firstStructuredImageUrl(
    entry["media:thumbnail"],
    true,
  );
  if (mediaThumbnail) {
    return mediaThumbnail;
  }
  const enclosure = firstStructuredImageUrl(entry.enclosure, false);
  if (enclosure) {
    return enclosure;
  }
  const atomEnclosure = firstAtomEnclosureUrl(entry.link);
  if (atomEnclosure) {
    return atomEnclosure;
  }
  return firstHtmlImageUrl(contentValues);
}

function firstStructuredImageUrl(
  value: unknown,
  assumeImage: boolean,
): string {
  for (const raw of arrayValue(value)) {
    const node = objectValue(raw);
    const candidate = canonicalizeImageUrl(
      textValue(node["@_url"]) ||
        textValue(node["@_href"]) ||
        textValue(raw),
    );
    if (
      candidate &&
      !isDecorativeImageResource(node, candidate) &&
      (assumeImage || isImageResource(node, candidate))
    ) {
      return candidate;
    }
  }
  return "";
}

function firstAtomEnclosureUrl(value: unknown): string {
  for (const raw of arrayValue(value)) {
    const node = objectValue(raw);
    if (textValue(node["@_rel"]).toLocaleLowerCase() !== "enclosure") {
      continue;
    }
    const candidate = canonicalizeImageUrl(
      textValue(node["@_href"]) || textValue(node["@_url"]),
    );
    if (candidate && !isDecorativeImageResource(node, candidate) &&
      isImageResource(node, candidate)) {
      return candidate;
    }
  }
  return "";
}

function isImageResource(node: XmlNode, url: string): boolean {
  const type = textValue(node["@_type"]).toLocaleLowerCase();
  if (type) {
    return type.startsWith("image/");
  }
  const medium = textValue(node["@_medium"]).toLocaleLowerCase();
  if (medium) {
    return medium === "image";
  }
  return IMAGE_FILE_EXTENSION.test(url);
}

function isDecorativeImageResource(node: XmlNode, sourceUrl: string): boolean {
  const width = Number.parseInt(textValue(node["@_width"]), 10);
  const height = Number.parseInt(textValue(node["@_height"]), 10);
  if (width <= 1 || height <= 1) {
    return true;
  }
  return DECORATIVE_IMAGE_HINT.test([
    sourceUrl,
    textValue(node["@_alt"]),
    textValue(node["@_class"]),
    textValue(node["@_id"]),
    textValue(node["@_name"]),
    textValue(node["@_title"]),
  ].join(" "));
}

export function canonicalizeImageUrl(value: string): string {
  const decoded = decodeHtmlAttribute(value).trim();
  if (!decoded) {
    return "";
  }
  const candidate = decoded.startsWith("//") ? `https:${decoded}` : decoded;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function firstHtmlImageUrl(values: unknown[]): string {
  for (const value of values) {
    for (const source of arrayValue(value)) {
      const html = textValue(source);
      for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
        const sourceUrl = getHtmlAttribute(tag, "src");
        if (!sourceUrl || isDecorativeImage(tag, sourceUrl)) {
          continue;
        }
        const candidate = canonicalizeImageUrl(sourceUrl);
        if (candidate) {
          return candidate;
        }
      }
    }
  }
  return "";
}

function isDecorativeImage(tag: string, sourceUrl: string): boolean {
  const width = Number.parseInt(getHtmlAttribute(tag, "width"), 10);
  const height = Number.parseInt(getHtmlAttribute(tag, "height"), 10);
  if (width <= 1 || height <= 1) {
    return true;
  }
  const hints = [
    sourceUrl,
    getHtmlAttribute(tag, "alt"),
    getHtmlAttribute(tag, "class"),
    getHtmlAttribute(tag, "id"),
    getHtmlAttribute(tag, "title"),
  ].join(" ");
  return DECORATIVE_IMAGE_HINT.test(hints);
}

function getHtmlAttribute(tag: string, name: string): string {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return decodeHtmlAttribute(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractJournal(entry: XmlNode, summary: string): string {
  const structured = firstText(
    entry.journal,
    entry["prism:publicationName"],
    entry["dc:source"],
    entry.source,
    entry.publication,
  );
  if (structured) {
    return structured;
  }
  return labeledMetadata(
    summary,
    String.raw`Source|Journal`,
    String.raw`Author\(s\)|Authors?|Publication date|Published|DOI`,
  ).replace(/,\s*(?:vol(?:ume)?|issue)\b.*$/i, "").trim();
}

function extractLink(entry: XmlNode): string {
  const links = arrayValue(entry.link);
  for (const raw of links) {
    if (typeof raw === "string") {
      return raw;
    }
    const link = objectValue(raw);
    const href = textValue(link["@_href"]);
    const relation = textValue(link["@_rel"]);
    if (href && (!relation || relation === "alternate")) {
      return href;
    }
  }
  return firstText(entry.guid, entry.id);
}

function extractAuthors(entry: XmlNode, summary: string): string {
  const values = [
    ...arrayValue(entry.author),
    ...arrayValue(entry["dc:creator"]),
  ]
    .map((value) => {
      const node = objectValue(value);
      return textValue(node.name) || textValue(value);
    })
    .filter(Boolean);
  if (values.length > 0) {
    return values.join("; ");
  }
  return labeledMetadata(
    summary,
    String.raw`作者|Author\(s\)|Authors?`,
    String.raw`DOI|Source|Journal|Publication date|Published`,
  );
}

function labeledMetadata(
  value: string,
  labels: string,
  followingLabels: string,
): string {
  const match = value.match(new RegExp(
    `(?:^|\\s)(?:${labels})\\s*[:：]\\s*(.*?)` +
      `(?=\\s+(?:${followingLabels})\\s*[:：]|$)`,
    "i",
  ));
  return match?.[1]?.trim() ?? "";
}

function parseDate(value: string): string {
  if (!value) {
    return "";
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function inferYear(...values: string[]): string {
  return values.join(" ").match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textValue(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(" ").trim();
  }
  if (value && typeof value === "object") {
    const node = value as XmlNode;
    return firstText(node["#text"], node["#cdata"]);
  }
  return "";
}

function objectValue(value: unknown): XmlNode {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
