import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";

import type { ParsedItem } from "../models/domain";

interface XmlNode {
  [key: string]: unknown;
}

export interface ParsedFeed {
  title: string;
  items: ParsedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  textNodeName: "#text",
  trimValues: true,
  processEntities: true,
});

export function parseFeed(xml: string, fallbackName: string): ParsedFeed {
  const document = parser.parse(xml) as XmlNode;
  const rssChannel = objectValue(objectValue(document.rss).channel);
  const atomFeed = objectValue(document.feed);
  const channel = Object.keys(rssChannel).length > 0 ? rssChannel : atomFeed;
  const rawEntries =
    Object.keys(rssChannel).length > 0
      ? arrayValue(channel.item)
      : arrayValue(channel.entry);
  const title = textValue(channel.title) || fallbackName;

  return {
    title,
    items: rawEntries
      .map((entry) => entryToItem(objectValue(entry), fallbackName))
      .filter((item) => Boolean(item.title)),
  };
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
    url.hash = "";
    if (!url.hostname.toLocaleLowerCase().includes("cnki")) {
      url.search = "";
    }
    return url.toString();
  } catch {
    return link;
  }
}

export function findDoi(...values: string[]): string {
  const match = values
    .join(" ")
    .match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match?.[0]?.replace(/[.,;)\]]+$/, "").toLocaleLowerCase() ?? "";
}

export function stableGuid(input: {
  title: string;
  journal: string;
  year: string;
  authors: string;
  doi: string;
}): string {
  if (input.doi) {
    return `doi:${input.doi}`;
  }
  const title = normalizeText(input.title);
  const author = normalizeText(input.authors).slice(0, 48);
  const identity = author
    ? [title, input.year || "", author]
    : [title, input.year || "", normalizeText(input.journal)];
  const digest = createHash("sha256")
    .update(identity.join("|"))
    .digest("hex")
    .slice(0, 24);
  return `cnki-local:${digest}`;
}

function entryToItem(entry: XmlNode, feedName: string): ParsedItem {
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
  const authors = extractAuthors(entry, summary);
  const pubDate = parseDate(
    firstText(entry.pubDate, entry.published, entry.updated, entry.date),
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
      journal: feedName.trim(),
      year,
      authors,
      doi,
    }),
    title,
    titleNorm: normalizeText(title),
    authors,
    journal: feedName.trim(),
    year,
    doi,
    link,
    pubDate,
    summary,
  };
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
