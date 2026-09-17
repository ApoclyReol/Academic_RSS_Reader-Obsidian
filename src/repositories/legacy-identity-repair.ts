import {
  RssDatabase,
  type Database,
} from "../database/database";
import {
  canonicalizeLink,
  publisherIdentity,
  stableGuid,
} from "../models/item-identity";
import { sha256 } from "../infrastructure/desktop-runtime";
import {
  statusPriority,
  textValue,
  type RepositoryRow,
} from "./repository-helpers";
import type { ItemStatus } from "../models/domain";

interface LegacyIdentityCandidate {
  id: number;
  status: ItemStatus;
  lastSeenAt: string;
}

export interface LegacyIdentityRepairResult {
  mergedGroups: number;
  removedItems: number;
  rekeyedItems: number;
}

export async function repairLegacyItemIdentity(
  database: RssDatabase,
): Promise<LegacyIdentityRepairResult> {
  if (
    database.get<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key='legacy_identity_repair_v3'",
    )?.value === "completed"
  ) {
    return { mergedGroups: 0, removedItems: 0, rekeyedItems: 0 };
  }

  const rows = database.query<RepositoryRow>(
    `
    SELECT i.*, f.name AS feed_name, f.journal_name AS feed_journal,
           (SELECT COUNT(*) FROM item_feeds x WHERE x.item_id=i.id) AS feed_count
    FROM items i
    LEFT JOIN item_feeds ifd ON ifd.item_id=i.id
    LEFT JOIN feeds f ON f.id=ifd.feed_id
    ORDER BY i.id
    `,
  );
  const identities = new Map<string, LegacyIdentityCandidate[]>();
  for (const row of rows) {
    if (Number(row.feed_count) !== 1) {
      continue;
    }
    const feedName = textValue(row.feed_name);
    const articleJournal = textValue(row.article_journal ?? row.journal);
    const feedJournal = textValue(row.feed_journal);
    const canonicalGuid = stableGuid({
      title: textValue(row.title),
      journal: articleJournal || feedJournal || feedName,
      year: textValue(row.year),
      authors: textValue(row.authors),
      doi: textValue(row.doi),
      link: textValue(row.link),
    }, sha256);
    const link = canonicalizeLink(textValue(row.link));
    const publisherId = publisherIdentity(link);
    const doi = textValue(row.doi)
      .trim()
      .toLocaleLowerCase()
      .replace(/^doi:\s*/i, "");
    const repairIdentity = doi
      ? `doi:${doi}`
      : publisherId ||
        (link ? `url:${link}|${textValue(row.title_norm)}` : canonicalGuid);
    const group = identities.get(repairIdentity) ?? [];
    group.push({
      id: Number(row.id),
      status: textValue(row.item_status) as ItemStatus,
      lastSeenAt: textValue(row.last_seen_at),
    });
    identities.set(repairIdentity, group);
  }

  return database.write((db: Database) => {
    let mergedGroups = 0;
    let removedItems = 0;
    let rekeyedItems = 0;
    const removedIds = new Set<number>();
    for (const candidates of identities.values()) {
      const unique = [
        ...new Map(
          candidates
            .filter((item) => !removedIds.has(item.id))
            .map((item) => [item.id, item]),
        ).values(),
      ];
      const ranked = [...unique].sort(
        (left, right) =>
          statusPriority(right.status) - statusPriority(left.status) ||
          right.lastSeenAt.localeCompare(left.lastSeenAt) ||
          left.id - right.id,
      );
      if (unique.length === 0) {
        continue;
      }
      const winner = ranked[0];
      if (!winner) {
        continue;
      }
      const preservedStatus = ranked[0]?.status ?? winner.status;
      const losers = unique.filter((item) => item.id !== winner.id);
      if (losers.length > 0) {
        const placeholders = losers
          .map((_, index) => `$loser${index}`)
          .join(",");
        const params = Object.fromEntries(
          losers.map((item, index) => [`$loser${index}`, item.id]),
        );
        const allParams = { ...params, $winner: winner.id };
        db.run(
          `
          INSERT OR IGNORE INTO item_feeds(
            item_id,feed_id,first_seen_at,last_seen_at
          )
          SELECT $winner,feed_id,first_seen_at,last_seen_at
          FROM item_feeds WHERE item_id IN (${placeholders})
          `,
          allParams,
        );
        db.run(
          `
          INSERT OR IGNORE INTO translations(
            item_id,field,source_text,translated_text,source_language,
            target_language,provider,source_hash,status,attempt_count,
            last_error,translated_at
          )
          SELECT $winner,field,source_text,translated_text,source_language,
                 target_language,provider,source_hash,status,attempt_count,
                 last_error,translated_at
          FROM translations
          WHERE item_id IN (${placeholders})
          ORDER BY CASE status WHEN 'succeeded' THEN 0 ELSE 1 END,
                   translated_at DESC
          `,
          allParams,
        );
        db.run(
          `
          INSERT OR IGNORE INTO recommendation_scores(
            item_id,keyword_score,keyword_tier,final_tier,llm_tier,
            llm_error,matched_keywords,model_version,content_hash,
            scored_at,llm_reviewed_at
          )
          SELECT $winner,keyword_score,keyword_tier,final_tier,llm_tier,
                 llm_error,matched_keywords,model_version,content_hash,
                 scored_at,llm_reviewed_at
          FROM recommendation_scores
          WHERE item_id IN (${placeholders})
          ORDER BY scored_at DESC LIMIT 1
          `,
          allParams,
        );
        db.run(
          `
          UPDATE items
          SET first_seen_at=(
                SELECT MIN(first_seen_at) FROM items
                WHERE id=$winner OR id IN (${placeholders})
              ),
              last_seen_at=(
                SELECT MAX(last_seen_at) FROM items
                WHERE id=$winner OR id IN (${placeholders})
              ),
              image_url=COALESCE(
                NULLIF(image_url,''),
                (
                  SELECT image_url FROM items
                  WHERE (id=$winner OR id IN (${placeholders}))
                    AND NULLIF(image_url,'') IS NOT NULL
                  ORDER BY CASE WHEN id=$winner THEN 0 ELSE 1 END, id
                  LIMIT 1
                )
              ),
              item_status=$status
          WHERE id=$winner
          `,
          { ...allParams, $status: preservedStatus },
        );
        db.run(
          `DELETE FROM translations WHERE item_id IN (${placeholders})`,
          params,
        );
        db.run(
          `DELETE FROM recommendation_scores WHERE item_id IN (${placeholders})`,
          params,
        );
        db.run(
          `DELETE FROM item_feeds WHERE item_id IN (${placeholders})`,
          params,
        );
        db.run(
          `DELETE FROM items WHERE id IN (${placeholders})`,
          params,
        );
        mergedGroups += 1;
        removedItems += losers.length;
        for (const loser of losers) {
          removedIds.add(loser.id);
        }
      }
    }
    db.run(
      `
      INSERT INTO app_metadata(key,value)
      VALUES ('legacy_identity_repair_v3','completed')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `,
    );
    return { mergedGroups, removedItems, rekeyedItems };
  });
}
