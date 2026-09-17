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

export type HashText = (value: string) => string;

export interface StableGuidInput {
  title: string;
  journal: string;
  year: string;
  authors: string;
  doi: string;
  link?: string;
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

export function stableGuid(input: StableGuidInput, hashText: HashText): string {
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
  const digest = hashText(identity.join("|")).slice(0, 24);
  return `${publisherId && !author ? "publisher" : "cnki-local"}:${digest}`;
}

function stripHtml(value: string): string {
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
