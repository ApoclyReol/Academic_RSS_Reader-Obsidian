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
  const summary = stripHtml(
    firstText(
      entry.summary,
      entry.description,
      entry.content,
      entry["content:encoded"],
    ),
  );
  const link = canonicalizeLink(extractLink(entry));
  const journal = extractJournal(entry);
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
  };
}

function extractJournal(entry: XmlNode): string {
  return firstText(
    entry.journal,
    entry["prism:publicationName"],
    entry["dc:source"],
    entry.source,
    entry.publication,
  );
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
  const match = summary.match(
    /(?:^|[\n。；;])\s*(?:作者|Authors?)[:：]\s*([^。;；]+)/i,
  );
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
