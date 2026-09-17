import type { SqlValue } from "../database/database";
import type { ItemQuery, ItemStatus } from "../models/domain";

export type RepositoryRow = Record<string, SqlValue>;

export const ITEM_JOURNAL_VALUE = `
  COALESCE(
    NULLIF(i.article_journal,''),
    (
      SELECT NULLIF(f.journal_name,'')
      FROM item_feeds x JOIN feeds f ON f.id=x.feed_id
      WHERE x.item_id=i.id AND NULLIF(f.journal_name,'') IS NOT NULL
      ORDER BY x.first_seen_at, f.id
      LIMIT 1
    ),
    ''
  )`;

export const ITEM_JOURNAL_SELECT = `
  ${ITEM_JOURNAL_VALUE} AS journal,
  COALESCE((SELECT GROUP_CONCAT(f.name,' ')
    FROM item_feeds x JOIN feeds f ON f.id=x.feed_id
    WHERE x.item_id=i.id),'') AS feed_names`;

export const INFERRED_FEED_JOURNAL_SELECT = `
  (
    SELECT NULLIF(i.article_journal,'')
    FROM item_feeds x
    JOIN items i ON i.id=x.item_id
    WHERE x.feed_id=f.id AND NULLIF(i.article_journal,'') IS NOT NULL
    GROUP BY i.article_journal
    ORDER BY COUNT(*) DESC, i.article_journal COLLATE NOCASE
    LIMIT 1
  ) AS inferred_journal`;

export function textValue(value: SqlValue, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint"
    ? String(value)
    : fallback;
}

function isMalformedImportedMetadata(value: string): boolean {
  return /^(?:xmlUrl|htmlUrl)\s*=/i.test(value.trim());
}

export function feedDisplayMetadata(
  value: string,
  inferredJournal: string,
  feedUrl: string,
): string {
  if (!isMalformedImportedMetadata(value)) {
    return value;
  }
  if (inferredJournal) {
    return inferredJournal;
  }
  try {
    return new URL(feedUrl).hostname.replace(/^www\./i, "");
  } catch {
    return value;
  }
}

export function statusPriority(status: ItemStatus): number {
  return {
    archived: 5,
    interested: 4,
    hidden: 3,
    expired: 2,
    unread: 1,
  }[status];
}

export function itemOrderBy(sort: ItemQuery["sort"]): string {
  switch (sort ?? "relevance") {
    case "title":
      return "i.title COLLATE NOCASE ASC, i.id DESC";
    case "updated":
      return `
        i.last_seen_at DESC,
        COALESCE(i.pub_date,i.first_seen_at) DESC,
        i.id DESC
      `;
    case "journal":
      return `
        ${ITEM_JOURNAL_VALUE} COLLATE NOCASE ASC,
        i.title COLLATE NOCASE ASC,
        i.id DESC
      `;
    case "relevance":
      return `
        CASE rs.final_tier WHEN 'high' THEN 0 WHEN 'pending' THEN 1
          WHEN 'low' THEN 3 ELSE 2 END,
        COALESCE(rs.keyword_score,-1) DESC,
        COALESCE(i.pub_date,i.first_seen_at) DESC,
        i.id DESC
      `;
  }
}

export function searchTerms(value: string | undefined): string[] {
  const terms = value?.normalize("NFKC").toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(terms)];
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
