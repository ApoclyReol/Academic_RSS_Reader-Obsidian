import {
  RssDatabase,
  type Database,
  type SqlValue,
} from "../database/database";
import {
  canonicalizeLink,
  publisherIdentity,
  normalizeText,
} from "../models/item-identity";
import {
  ITEM_STATUSES,
  type Feed,
  type FeedInput,
  type ItemQuery,
  type ItemStatus,
  type KeywordRecord,
  type ParsedItem,
  type RecommendationSummary,
  type RssItem,
  type TranslationField,
  type TranslationRecord,
  type TranslationStatus,
} from "../models/domain";
import {
  ITEM_JOURNAL_SELECT,
  ITEM_JOURNAL_VALUE,
  INFERRED_FEED_JOURNAL_SELECT,
  escapeLikePattern,
  feedDisplayMetadata,
  itemOrderBy,
  searchTerms,
  textValue,
  type RepositoryRow,
} from "./repository-helpers";
import {
  repairLegacyItemIdentity as repairLegacyItemIdentityInDatabase,
  type LegacyIdentityRepairResult,
} from "./legacy-identity-repair";
import { toFeed, toItem, toTranslation } from "./row-mappers";
import { repairTitleMarkup } from "./title-maintenance";
import { cleanTitleText } from "../models/title-text";
import { translationInputText } from "../models/translation-source";

type Row = RepositoryRow;

const ITEM_STATUS_BATCH_SIZE = 500;

export class RssRepository {
  constructor(private readonly database: RssDatabase) {}

  async repairLegacyItemIdentity(): Promise<LegacyIdentityRepairResult> {
    return repairLegacyItemIdentityInDatabase(this.database);
  }

  async repairTitleMarkup(): Promise<void> {
    await repairTitleMarkup(this.database);
  }

  listFeeds(includeDisabled = true): Feed[] {
    return this.database
      .query<Row>(
        `
        SELECT f.*, COUNT(ifd.item_id) AS item_count,
          ${INFERRED_FEED_JOURNAL_SELECT}
        FROM feeds f
        LEFT JOIN item_feeds ifd ON ifd.feed_id=f.id
        ${includeDisabled ? "" : "WHERE f.enabled=1"}
        GROUP BY f.id
        ORDER BY f.name COLLATE NOCASE
        `,
      )
      .map(toFeed);
  }

  getFeed(feedId: number): Feed | null {
    const row = this.database.get<Row>(
      `
      SELECT f.*, COUNT(ifd.item_id) AS item_count,
        ${INFERRED_FEED_JOURNAL_SELECT}
      FROM feeds f
      LEFT JOIN item_feeds ifd ON ifd.feed_id=f.id
      WHERE f.id=$id
      GROUP BY f.id
      `,
      { $id: feedId },
    );
    return row ? toFeed(row) : null;
  }

  async addFeed(input: FeedInput): Promise<number> {
    return this.database.write((db) => {
      db.run(
        "INSERT INTO feeds(name,journal_name,url,enabled) VALUES ($name,$journalName,$url,$enabled)",
        {
          $name: input.name,
          $journalName: input.journalName?.trim() || input.name,
          $url: input.url,
          $enabled: input.enabled ? 1 : 0,
        },
      );
      return this.lastInsertId(db);
    });
  }

  async updateFeed(feedId: number, input: FeedInput): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        UPDATE feeds
        SET name=$name, journal_name=$journalName, url=$url, enabled=$enabled,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=$id
        `,
        {
          $id: feedId,
          $name: input.name,
          $journalName: input.journalName?.trim() || input.name,
          $url: input.url,
          $enabled: input.enabled ? 1 : 0,
        },
      );
    });
  }

  async deleteFeeds(feedIds: number[]): Promise<number> {
    if (feedIds.length === 0) {
      return 0;
    }
    return this.database.write((db) => {
      const placeholders = feedIds.map((_, index) => `$id${index}`).join(",");
      const params = Object.fromEntries(
        feedIds.map((id, index) => [`$id${index}`, id]),
      );
      db.run(
        `DELETE FROM feeds WHERE id IN (${placeholders})`,
        params,
      );
      const deleted = db.getRowsModified();
      db.run(
        "DELETE FROM items WHERE NOT EXISTS (SELECT 1 FROM item_feeds WHERE item_feeds.item_id=items.id)",
      );
      return deleted;
    });
  }

  async updateFeedCheck(
    feedId: number,
    error: string | null,
    cache: {
      etag?: string | null;
      lastModified?: string | null;
      success?: boolean;
      nextAutoUpdateAt?: string | null;
    } = {},
  ): Promise<void> {
    await this.database.write((db) => {
      if (cache.success) {
        db.run(
          `
          UPDATE feeds SET
            last_checked_at=CURRENT_TIMESTAMP,last_success_at=CURRENT_TIMESTAMP,
            last_error=NULL,consecutive_failures=0,health_status='healthy',
            next_auto_update_at=NULL,
            etag=COALESCE($etag,etag),
            last_modified=COALESCE($lastModified,last_modified)
          WHERE id=$id
          `,
          {
            $id: feedId,
            $etag: cache.etag ?? null,
            $lastModified: cache.lastModified ?? null,
          },
        );
        return;
      }
      db.run(
        `
        UPDATE feeds SET
          last_checked_at=CURRENT_TIMESTAMP,last_error=$error,
          consecutive_failures=consecutive_failures+1,
          health_status=CASE WHEN consecutive_failures+1>=3
            THEN 'failing' ELSE 'degraded' END,
          next_auto_update_at=$nextAutoUpdateAt
        WHERE id=$id
        `,
        {
          $id: feedId,
          $error: error,
          $nextAutoUpdateAt: cache.nextAutoUpdateAt ?? null,
        },
      );
    });
  }

  async upsertParsedItems(
    feedId: number,
    items: ParsedItem[],
  ): Promise<{
    insertedIds: number[];
    duplicateHits: number;
    newFeedLinks: number;
  }> {
    return this.database.write((db) => {
      const insertedIds: number[] = [];
      let duplicateHits = 0;
      let newFeedLinks = 0;
      db.run(
        `
        UPDATE items SET image_url=NULL
        WHERE image_url='' AND id IN (
          SELECT item_id FROM item_feeds WHERE feed_id=$feedId
        )
        `,
        { $feedId: feedId },
      );

      for (const item of items) {
        const existingId = this.findExistingItemId(db, item);
        let itemId: number;
        if (existingId !== null) {
          itemId = existingId;
          duplicateHits += 1;
          db.run(
            `
            UPDATE items SET
              last_seen_at=CURRENT_TIMESTAMP,
              title=COALESCE(NULLIF($title,''),title),
              title_norm=COALESCE(NULLIF($titleNorm,''),title_norm),
              authors=COALESCE(NULLIF($authors,''),authors),
              article_journal=COALESCE(NULLIF($journal,''),article_journal),
              year=COALESCE(NULLIF($year,''),year),
              doi=COALESCE(NULLIF($doi,''),doi),
              link=COALESCE(NULLIF($link,''),link),
              pub_date=COALESCE(NULLIF($pubDate,''),pub_date),
              summary=COALESCE(NULLIF($summary,''),summary),
              image_url=COALESCE(NULLIF($imageUrl,''),image_url)
            WHERE id=$id
            `,
            this.parsedItemParams(item, itemId),
          );
        } else {
          db.run(
            `
            INSERT INTO items(
              stable_guid,title,title_norm,authors,article_journal,year,doi,link,pub_date,summary,image_url
            ) VALUES (
              $stableGuid,$title,$titleNorm,$authors,$journal,$year,$doi,$link,$pubDate,$summary,$imageUrl
            )
            `,
            this.parsedItemParams(item),
          );
          itemId = this.lastInsertId(db);
          insertedIds.push(itemId);
        }

        const linked = this.singleValue(
          db,
          "SELECT 1 FROM item_feeds WHERE item_id=$itemId AND feed_id=$feedId",
          { $itemId: itemId, $feedId: feedId },
        );
        if (linked) {
          db.run(
            `
            UPDATE item_feeds SET last_seen_at=CURRENT_TIMESTAMP
            WHERE item_id=$itemId AND feed_id=$feedId
            `,
            { $itemId: itemId, $feedId: feedId },
          );
        } else {
          db.run(
            "INSERT INTO item_feeds(item_id,feed_id) VALUES ($itemId,$feedId)",
            { $itemId: itemId, $feedId: feedId },
          );
          newFeedLinks += 1;
        }
      }
      db.run(
        "UPDATE feeds SET last_checked_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=$id",
        { $id: feedId },
      );
      return { insertedIds, duplicateHits, newFeedLinks };
    });
  }

  listItems(query: ItemQuery): RssItem[] {
    const { where, params } = this.itemWhere(query);
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const orderBy = itemOrderBy(query.sort);
    return this.database
      .query<Row>(
        `
        SELECT
          i.*, ${ITEM_JOURNAL_SELECT},
          rs.final_tier, rs.keyword_score, rs.llm_tier, rs.matched_keywords,
          tt.translated_text AS translated_title, tt.status AS title_translation_status,
          ta.translated_text AS translated_abstract, ta.status AS abstract_translation_status
        FROM items i
        LEFT JOIN recommendation_scores rs ON rs.item_id=i.id
        LEFT JOIN translations tt
          ON tt.item_id=i.id AND tt.field='title'
          AND tt.target_language=$translationTarget
          AND tt.source_normalized=i.title
        LEFT JOIN translations ta
          ON ta.item_id=i.id AND ta.field='abstract'
          AND ta.target_language=$translationTarget
          AND ta.source_normalized=COALESCE(i.summary,'')
        ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
        `,
        params,
      )
      .map(toItem);
  }

  getItem(itemId: number, targetLanguage = "zh-CN"): RssItem | null {
    const row = this.database.get<Row>(
      `
      SELECT i.*,${ITEM_JOURNAL_SELECT},rs.final_tier,rs.keyword_score,rs.llm_tier,rs.matched_keywords,
        tt.translated_text AS translated_title,tt.status AS title_translation_status,
        ta.translated_text AS translated_abstract,ta.status AS abstract_translation_status
      FROM items i
      LEFT JOIN recommendation_scores rs ON rs.item_id=i.id
      LEFT JOIN translations tt
        ON tt.item_id=i.id AND tt.field='title'
        AND tt.target_language=$target
        AND tt.source_normalized=i.title
      LEFT JOIN translations ta
        ON ta.item_id=i.id AND ta.field='abstract'
        AND ta.target_language=$target
        AND ta.source_normalized=COALESCE(i.summary,'')
      WHERE i.id=$id
      `,
      { $id: itemId, $target: targetLanguage },
    );
    return row ? toItem(row) : null;
  }

  countItems(query?: Partial<ItemQuery>): number {
    if (!query?.status) {
      return Number(
        this.database.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM items",
        )?.count ?? 0,
      );
    }
    const { where, params } = this.itemWhere(query as ItemQuery);
    return Number(
      this.database.get<{ count: number }>(
        `SELECT COUNT(DISTINCT i.id) AS count FROM items i ${where}`,
        params,
      )?.count ?? 0,
    );
  }

  countByStatus(): Record<ItemStatus | "total", number> {
    const counts = Object.fromEntries(
      ITEM_STATUSES.map((status) => [status, 0]),
    ) as Record<ItemStatus, number>;
    let total = 0;
    for (const row of this.database.query<{ item_status: ItemStatus; count: number }>(
      "SELECT item_status,COUNT(*) AS count FROM items GROUP BY item_status",
    )) {
      if (ITEM_STATUSES.includes(row.item_status)) {
        counts[row.item_status] = Number(row.count);
        total += Number(row.count);
      }
    }
    return { ...counts, total };
  }

  async setItemStatus(itemIds: number[], status: ItemStatus): Promise<number> {
    if (itemIds.length === 0) {
      return 0;
    }
    const uniqueItemIds = [...new Set(itemIds)];
    return this.database.write((db) => {
      let changed = 0;
      for (
        let offset = 0;
        offset < uniqueItemIds.length;
        offset += ITEM_STATUS_BATCH_SIZE
      ) {
        const batch = uniqueItemIds.slice(
          offset,
          offset + ITEM_STATUS_BATCH_SIZE,
        );
        const placeholders = batch
          .map((_, index) => `$id${index}`)
          .join(",");
        db.run(
          `UPDATE items SET item_status=$status WHERE id IN (${placeholders})`,
          {
            $status: status,
            ...Object.fromEntries(
              batch.map((id, index) => [`$id${index}`, id]),
            ),
          },
        );
        changed += db.getRowsModified();
      }
      return changed;
    });
  }

  async moveAllItems(
    fromStatus: ItemStatus,
    status: ItemStatus,
  ): Promise<number[]> {
    if (fromStatus === status) {
      return [];
    }
    return this.database.write((db) => {
      const itemIds = db.prepare(
        `
        SELECT id FROM items
        WHERE item_status=$fromStatus
        ORDER BY id
        `,
      ).all({ $fromStatus: fromStatus }).map((row) => Number(row.id));
      if (itemIds.length === 0) {
        return [];
      }
      db.run(
        `
        UPDATE items SET item_status=$status
        WHERE item_status=$fromStatus
        `,
        {
          $fromStatus: fromStatus,
          $status: status,
        },
      );
      return itemIds;
    });
  }

  async expireHiddenBefore(cutoffIso: string): Promise<number> {
    return this.database.write((db) => {
      db.run(
        `
        UPDATE items SET item_status='expired'
        WHERE item_status='hidden' AND last_seen_at < $cutoff
        `,
        { $cutoff: cutoffIso },
      );
      return db.getRowsModified();
    });
  }

  listFeedStats(): Row[] {
    return this.database.query<Row>(`
      SELECT f.id,f.name,f.journal_name,f.url,f.enabled,
        ${INFERRED_FEED_JOURNAL_SELECT},
        COUNT(DISTINCT i.id) AS total_count,
        SUM(CASE WHEN i.item_status='unread' THEN 1 ELSE 0 END) AS unread_count,
        SUM(CASE WHEN i.item_status='interested' THEN 1 ELSE 0 END) AS interested_count,
        SUM(CASE WHEN i.item_status='archived' THEN 1 ELSE 0 END) AS archived_count,
        SUM(CASE WHEN i.item_status='hidden' THEN 1 ELSE 0 END) AS hidden_count,
        SUM(CASE WHEN i.item_status='expired' THEN 1 ELSE 0 END) AS expired_count
      FROM feeds f
      LEFT JOIN item_feeds ifd ON ifd.feed_id=f.id
      LEFT JOIN items i ON i.id=ifd.item_id
      GROUP BY f.id
      ORDER BY f.name COLLATE NOCASE
    `).map((row) => ({
      ...row,
      name: feedDisplayMetadata(
        textValue(row.name),
        textValue(row.inferred_journal),
        textValue(row.url),
      ),
    }));
  }

  getTranslation(
    itemId: number,
    field: TranslationField,
    targetLanguage: string,
  ): TranslationRecord | null {
    const row = this.database.get<Row>(
      `
      SELECT * FROM translations
      WHERE item_id=$itemId AND field=$field AND target_language=$target
      `,
      { $itemId: itemId, $field: field, $target: targetLanguage },
    );
    return row ? toTranslation(row) : null;
  }

  listTranslationsByStatus(
    statuses: TranslationStatus[],
  ): TranslationRecord[] {
    if (statuses.length === 0) {
      return [];
    }
    const values = statuses.map((status) => `'${status}'`).join(",");
    return this.database
      .query<Row>(
        `SELECT * FROM translations WHERE status IN (${values}) ORDER BY item_id`,
      )
      .map(toTranslation);
  }

  async upsertTranslationTask(record: TranslationRecord, force = false): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        INSERT INTO translations(
          item_id,field,source_text,translated_text,source_language,target_language,
          provider,source_hash,status,attempt_count,last_error,translated_at,source_normalized
        ) VALUES (
          $itemId,$field,$sourceText,$translatedText,$sourceLanguage,$targetLanguage,
          $provider,$sourceHash,$status,$attemptCount,$lastError,$translatedAt,$sourceNormalized
        )
        ON CONFLICT(item_id,field,target_language) DO UPDATE SET
          source_text=excluded.source_text,
          source_normalized=excluded.source_normalized,
          translated_text=CASE
            WHEN $force=0 AND translations.source_hash=excluded.source_hash
            THEN translations.translated_text ELSE NULL END,
          source_language=CASE
            WHEN $force=0 AND translations.source_hash=excluded.source_hash
            THEN translations.source_language ELSE NULL END,
          provider=excluded.provider,
          source_hash=excluded.source_hash,
          status=CASE
            WHEN $force=0 AND translations.source_hash=excluded.source_hash
              AND translations.status='succeeded'
            THEN 'succeeded' ELSE excluded.status END,
          attempt_count=CASE
            WHEN translations.source_hash=excluded.source_hash
              AND excluded.attempt_count=0
            THEN 0
            WHEN translations.source_hash=excluded.source_hash
            THEN translations.attempt_count ELSE 0 END,
          last_error=CASE
            WHEN translations.source_hash=excluded.source_hash
              AND excluded.attempt_count=0
            THEN excluded.last_error
            WHEN translations.source_hash=excluded.source_hash
            THEN translations.last_error ELSE NULL END,
          translated_at=CASE
            WHEN translations.source_hash=excluded.source_hash
              AND excluded.attempt_count=0
            THEN excluded.translated_at
            WHEN translations.source_hash=excluded.source_hash
            THEN translations.translated_at ELSE NULL END
        `,
        { ...this.translationParams(record), $force: force ? 1 : 0 },
      );
    });
  }

  async updateTranslation(record: TranslationRecord): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        UPDATE translations SET
          translated_text=$translatedText,
          source_language=$sourceLanguage,
          status=$status,
          attempt_count=$attemptCount,
          last_error=$lastError,
          translated_at=$translatedAt
        WHERE item_id=$itemId AND field=$field AND target_language=$targetLanguage
          AND source_hash=$sourceHash
        `,
        this.translationParams(record),
      );
    });
  }

  async deleteTranslationTask(
    itemId: number,
    field: TranslationField,
    targetLanguage: string,
  ): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        DELETE FROM translations
        WHERE item_id=$itemId AND field=$field AND target_language=$targetLanguage
        `,
        { $itemId: itemId, $field: field, $targetLanguage: targetLanguage },
      );
    });
  }

  listTrainingItems(): RssItem[] {
    return this.database
      .query<Row>(
        `
        SELECT i.*,${ITEM_JOURNAL_SELECT},
          NULL AS final_tier,NULL AS keyword_score,NULL AS llm_tier,
          '[]' AS matched_keywords,NULL AS translated_title,NULL AS translated_abstract,
          NULL AS title_translation_status,NULL AS abstract_translation_status
        FROM items i
        WHERE i.item_status IN ('interested','archived','hidden','expired')
        ORDER BY i.id
        `,
      )
      .map(toItem);
  }

  listUnreadItems(): RssItem[] {
    return this.database
      .query<Row>(
        `
        SELECT i.*,${ITEM_JOURNAL_SELECT},
          NULL AS final_tier,NULL AS keyword_score,NULL AS llm_tier,
          '[]' AS matched_keywords,NULL AS translated_title,NULL AS translated_abstract,
          NULL AS title_translation_status,NULL AS abstract_translation_status
        FROM items i
        WHERE i.item_status='unread'
        ORDER BY i.id
        `,
      )
      .map(toItem);
  }

  getRecommendationSummary(): RecommendationSummary {
    const counts = this.database.get<Row>(`
      SELECT
        SUM(CASE WHEN final_tier='high' THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN final_tier='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN final_tier='low' THEN 1 ELSE 0 END) AS low
      FROM recommendation_scores rs
      JOIN items i ON i.id=rs.item_id AND i.item_status='unread'
    `) ?? {};
    const unread = this.countItems({ status: "unread" });
    const model = this.database.get<Row>(
      "SELECT * FROM recommendation_models ORDER BY created_at DESC, rowid DESC LIMIT 1",
    );
    const scored =
      Number(counts.high ?? 0) +
      Number(counts.pending ?? 0) +
      Number(counts.low ?? 0);
    return {
      high: Number(counts.high ?? 0),
      pending: Number(counts.pending ?? 0),
      low: Number(counts.low ?? 0),
      unscored: Math.max(0, unread - scored),
      modelVersion: model ? String(model.model_version) : null,
      positiveCount: Number(model?.positive_count ?? 0),
      negativeCount: Number(model?.negative_count ?? 0),
      unreadCount: Number(model?.unread_count ?? 0),
      createdAt: model ? String(model.created_at) : null,
      intercept: Number(model?.intercept ?? 0),
      trainingHash: model?.training_hash
        ? textValue(model.training_hash)
        : null,
      validationAccuracy:
        model?.validation_accuracy === null ||
        model?.validation_accuracy === undefined
          ? null
          : Number(model.validation_accuracy),
      suggestedLowThreshold: Number(
        model?.suggested_low_threshold ?? 30,
      ),
      suggestedHighThreshold: Number(
        model?.suggested_high_threshold ?? 70,
      ),
      activeLowThreshold: Number(
        model?.suggested_low_threshold ?? 30,
      ),
      activeHighThreshold: Number(
        model?.suggested_high_threshold ?? 70,
      ),
      featureVersion: Number(model?.feature_version ?? 1),
      isStale: false,
      errorMessage: model?.error_message
        ? textValue(model.error_message)
        : null,
    };
  }

  listKeywords(limit = 100): KeywordRecord[] {
    return this.database
      .query<Row>(
        `
        SELECT *,
          CASE
            WHEN is_disabled=1 THEN 0
            ELSE auto_weight
          END AS effective_weight
        FROM recommendation_keywords
        ORDER BY is_disabled DESC, ABS(auto_weight) DESC
        LIMIT ${Math.max(1, Math.min(limit, 5000))}
        `,
      )
      .map((row) => ({
        keyword: String(row.keyword),
        idf: Number(row.idf ?? 1),
        autoWeight: Number(row.auto_weight),
        positiveCount: Number(row.positive_count),
        negativeCount: Number(row.negative_count),
        isDisabled: Boolean(row.is_disabled),
        effectiveWeight: Number(row.effective_weight),
      }));
  }

  listRecommendationScoreHashes(): Map<number, string> {
    return new Map(
      this.database
        .query<Row>("SELECT item_id,content_hash FROM recommendation_scores")
        .map((row) => [
          Number(row.item_id),
          String(row.content_hash),
        ]),
    );
  }

  async updateRecommendationScores(
    modelVersion: string,
    unreadIds: number[],
    scores: Array<{
      itemId: number;
      score: number;
      tier: string;
      matchedKeywords: string;
      contentHash: string;
    }>,
  ): Promise<void> {
    await this.database.write((db) => {
      if (unreadIds.length === 0) {
        db.run("DELETE FROM recommendation_scores");
      } else {
        const placeholders = unreadIds
          .map((_, index) => `$keep${index}`)
          .join(",");
        db.run(
          `DELETE FROM recommendation_scores WHERE item_id NOT IN (${placeholders})`,
          Object.fromEntries(
            unreadIds.map((id, index) => [`$keep${index}`, id]),
          ),
        );
      }
      const statement = db.prepare(`
        INSERT INTO recommendation_scores(
          item_id,keyword_score,keyword_tier,final_tier,matched_keywords,
          model_version,content_hash
        ) VALUES ($itemId,$score,$tier,$tier,$matched,$version,$hash)
        ON CONFLICT(item_id) DO UPDATE SET
          keyword_score=excluded.keyword_score,
          keyword_tier=excluded.keyword_tier,
          final_tier=excluded.final_tier,
          matched_keywords=excluded.matched_keywords,
          model_version=excluded.model_version,
          content_hash=excluded.content_hash,
          scored_at=CURRENT_TIMESTAMP,
          llm_tier=NULL,llm_error=NULL,llm_reviewed_at=NULL
      `);
      try {
        for (const score of scores) {
          statement.run({
            $itemId: score.itemId,
            $score: score.score,
            $tier: score.tier,
            $matched: score.matchedKeywords,
            $version: modelVersion,
            $hash: score.contentHash,
          });
        }
      } finally {
        statement.free();
      }
    });
  }

  async setKeywordDisabled(
    keyword: string,
    disabled: boolean,
  ): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        UPDATE recommendation_keywords SET
          is_disabled=$disabled,
          manual_direction=NULL,
          manual_weight=NULL,
          updated_at=CURRENT_TIMESTAMP
        WHERE keyword=$keyword
        `,
        {
          $keyword: keyword,
          $disabled: disabled ? 1 : 0,
        },
      );
    });
  }

  async replaceRecommendationResults(input: {
    modelVersion: string;
    positiveCount: number;
    negativeCount: number;
    unreadCount: number;
    intercept?: number;
    trainingHash?: string | null;
    validationAccuracy?: number | null;
    suggestedLowThreshold?: number;
    suggestedHighThreshold?: number;
    featureVersion?: number;
    errorMessage: string | null;
    keywords: Array<{
      keyword: string;
      autoWeight: number;
      positiveCount: number;
      negativeCount: number;
      idf?: number;
    }>;
    scores: Array<{
      itemId: number;
      score: number;
      tier: string;
      matchedKeywords: string;
      contentHash: string;
    }>;
  }): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        INSERT INTO recommendation_models(
          model_version,positive_count,negative_count,unread_count,error_message,
          intercept,training_hash,validation_accuracy,suggested_low_threshold,
          suggested_high_threshold,feature_version
        ) VALUES (
          $version,$positive,$negative,$unread,$error,$intercept,$trainingHash,
          $accuracy,$low,$high,$featureVersion
        )
        `,
        {
          $version: input.modelVersion,
          $positive: input.positiveCount,
          $negative: input.negativeCount,
          $unread: input.unreadCount,
          $error: input.errorMessage,
          $intercept: input.intercept ?? 0,
          $trainingHash: input.trainingHash ?? null,
          $accuracy: input.validationAccuracy ?? null,
          $low: input.suggestedLowThreshold ?? 30,
          $high: input.suggestedHighThreshold ?? 70,
          $featureVersion: input.featureVersion ?? 1,
        },
      );
      db.run(
        `
        DELETE FROM recommendation_models
        WHERE rowid NOT IN (
          SELECT rowid FROM recommendation_models
          ORDER BY created_at DESC, rowid DESC
          LIMIT 10
        )
        `,
      );
      if (input.errorMessage) {
        return;
      }
      db.run("DELETE FROM recommendation_scores");
      db.run(
        `
        DELETE FROM recommendation_keywords
        WHERE is_disabled=0
        `,
      );
      const keywordStatement = db.prepare(
        `
          INSERT INTO recommendation_keywords(
            keyword,auto_weight,positive_count,negative_count,model_version,idf
          ) VALUES ($keyword,$weight,$positive,$negative,$version,$idf)
          ON CONFLICT(keyword) DO UPDATE SET
            auto_weight=excluded.auto_weight,
            positive_count=excluded.positive_count,
            negative_count=excluded.negative_count,
            model_version=excluded.model_version,
            idf=excluded.idf,
            updated_at=CURRENT_TIMESTAMP
          `,
      );
      try {
        for (const keyword of input.keywords) {
          keywordStatement.run({
            $keyword: keyword.keyword,
            $weight: keyword.autoWeight,
            $positive: keyword.positiveCount,
            $negative: keyword.negativeCount,
            $idf: keyword.idf ?? 1,
            $version: input.modelVersion,
          });
        }
      } finally {
        keywordStatement.free();
      }
      const scoreStatement = db.prepare(
        `
          INSERT INTO recommendation_scores(
            item_id,keyword_score,keyword_tier,final_tier,matched_keywords,
            model_version,content_hash
          ) VALUES ($itemId,$score,$tier,$tier,$matched,$version,$hash)
          `,
      );
      try {
        for (const score of input.scores) {
          scoreStatement.run({
            $itemId: score.itemId,
            $score: score.score,
            $tier: score.tier,
            $matched: score.matchedKeywords,
            $version: input.modelVersion,
            $hash: score.contentHash,
          });
        }
      } finally {
        scoreStatement.free();
      }
    });
  }

  listPendingLlmItems(): RssItem[] {
    return this.database
      .query<Row>(
        `
        SELECT i.*,${ITEM_JOURNAL_SELECT},rs.final_tier,rs.keyword_score,rs.llm_tier,rs.matched_keywords,
          NULL AS translated_title,NULL AS translated_abstract,
          NULL AS title_translation_status,NULL AS abstract_translation_status
        FROM items i
        JOIN recommendation_scores rs ON rs.item_id=i.id
        WHERE i.item_status='unread' AND rs.keyword_tier='pending'
          AND rs.llm_tier IS NULL
        ORDER BY i.id
        `,
      )
      .map(toItem);
  }

  async saveLlmReview(
    itemId: number,
    tier: "high" | "low" | null,
    error: string | null,
  ): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        UPDATE recommendation_scores SET
          llm_tier=$tier,
          final_tier=COALESCE($tier,keyword_tier),
          llm_error=$error,
          llm_reviewed_at=CURRENT_TIMESTAMP
        WHERE item_id=$itemId
        `,
        { $itemId: itemId, $tier: tier, $error: error },
      );
    });
  }

  listLowRecommendationIds(query: string, feedIds: number[]): number[] {
    const { where, params } = this.itemWhere({
      status: "unread",
      query,
      feedIds,
      limit: 500,
    });
    return this.database
      .query<{ id: number }>(
        `
        SELECT DISTINCT i.id FROM items i
        JOIN recommendation_scores rs ON rs.item_id=i.id
        ${where} AND rs.final_tier='low'
        `,
        params,
      )
      .map((row) => Number(row.id));
  }

  getMetadata(key: string): string | null {
    return (
      this.database.get<{ value: string }>(
        "SELECT value FROM app_metadata WHERE key=$key",
        { $key: key },
      )?.value ?? null
    );
  }

  async setMetadata(key: string, value: string): Promise<void> {
    await this.database.write((db) => {
      db.run(
        `
        INSERT INTO app_metadata(key,value) VALUES ($key,$value)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `,
        { $key: key, $value: value },
      );
    });
  }

  private itemWhere(query: ItemQuery): {
    where: string;
    params: Record<string, unknown>;
  } {
    const conditions = ["i.item_status=$status"];
    const params: Record<string, unknown> = {
      $status: query.status,
      $translationTarget: query.targetLanguage ?? "zh-CN",
    };
    const searchableFields = [
      "i.title_norm",
      "LOWER(COALESCE(i.title,''))",
      `LOWER(COALESCE((SELECT translated_text FROM translations
        WHERE item_id=i.id AND field='title'
          AND source_normalized=i.title
          AND target_language=$translationTarget AND status='succeeded'),''))`,
      "LOWER(COALESCE(i.authors,''))",
      "LOWER(COALESCE(i.summary,''))",
      `LOWER(COALESCE((SELECT translated_text FROM translations
        WHERE item_id=i.id AND field='abstract'
          AND source_normalized=COALESCE(i.summary,'')
          AND target_language=$translationTarget AND status='succeeded'),''))`,
      "LOWER(COALESCE(i.article_journal,''))",
      `LOWER(${ITEM_JOURNAL_VALUE})`,
      `LOWER(COALESCE((SELECT GROUP_CONCAT(DISTINCT f.name)
        FROM item_feeds x JOIN feeds f ON f.id=x.feed_id
        WHERE x.item_id=i.id),''))`,
      "LOWER(COALESCE(i.year,''))",
      "LOWER(COALESCE(i.doi,''))",
      "LOWER(COALESCE(i.link,''))",
    ];
    const terms = searchTerms(query.query);
    if (terms.length > 0) {
      conditions.push(terms.map((term, index) => {
        const parameter = `$query${index}`;
        params[parameter] = `%${escapeLikePattern(term)}%`;
        return `(${searchableFields.map((field) =>
          `${field} LIKE ${parameter} ESCAPE '\\'`
        ).join(" OR ")})`;
      }).join(" AND "));
    }
    if (query.feedIds && query.feedIds.length > 0) {
      const placeholders = query.feedIds
        .map((_, index) => `$feed${index}`)
        .join(",");
      conditions.push(`
        EXISTS (
          SELECT 1 FROM item_feeds ifd
          WHERE ifd.item_id=i.id AND ifd.feed_id IN (${placeholders})
        )
      `);
      for (const [index, id] of query.feedIds.entries()) {
        params[`$feed${index}`] = id;
      }
    }
    return { where: `WHERE ${conditions.join(" AND ")}`, params };
  }

  private findExistingItemId(
    db: Database,
    item: ParsedItem,
  ): number | null {
    for (const [sql, params] of [
      [
        "SELECT id FROM items WHERE stable_guid=$value LIMIT 1",
        { $value: item.stableGuid },
      ],
      ...(item.doi
        ? [[
            "SELECT id FROM items WHERE LOWER(COALESCE(doi,''))=LOWER($value) ORDER BY id DESC LIMIT 1",
            { $value: item.doi.replace(/^doi:\s*/i, "") },
          ]]
        : []),
      ...(item.link
        ? [[
            `SELECT id FROM items
             WHERE link=$value AND title_norm=$titleNorm
             ORDER BY id DESC LIMIT 1`,
            { $value: item.link, $titleNorm: item.titleNorm },
          ]]
        : []),
    ] as Array<[string, Record<string, unknown>]>) {
      const value = this.singleValue(db, sql, params);
      if (value !== null) {
        return Number(value);
      }
    }

    if (item.link) {
      const candidates = this.databaseItemsByTitleAndLink(db, item);
      if (candidates.length === 1) {
        return candidates[0]!;
      }
    }

    if (item.authors) {
      const statement = db.prepare(
        `
        SELECT i.id,i.article_journal,i.link,
          COALESCE(GROUP_CONCAT(DISTINCT f.journal_name), '') AS feed_journals
        FROM items i
        LEFT JOIN item_feeds ifd ON ifd.item_id=i.id
        LEFT JOIN feeds f ON f.id=ifd.feed_id
        WHERE i.title_norm=$title AND COALESCE(i.authors,'')=$authors
          AND COALESCE(i.year,'')=$year
        GROUP BY i.id
        ORDER BY i.id DESC
        `,
      );
      statement.bind({
        $title: item.titleNorm,
        $authors: item.authors,
        $year: item.year,
      });
      const rows: Array<{
        id: number;
        article_journal: string;
        feed_journals: string;
        link: string;
      }> = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as {
          id: number;
          article_journal: string;
          feed_journals: string;
          link: string;
        });
      }
      statement.free();
      const compatibleRows = rows.filter((row) =>
        this.publisherIdentitiesDoNotConflict(row.link, item.link)
      );
      if (compatibleRows.length === 1) {
        return Number(compatibleRows[0]?.id);
      }
      const exact = compatibleRows.filter((row) =>
        this.journalCandidates(row).includes(item.journal)
      );
      if (exact.length === 1) {
        return Number(exact[0]?.id);
      }
    } else {
      const rows = this.database.query<Row>(
        `
        SELECT i.id,i.article_journal,i.link,
          COALESCE(GROUP_CONCAT(DISTINCT f.journal_name), '') AS feed_journals
        FROM items i
        LEFT JOIN item_feeds ifd ON ifd.item_id=i.id
        LEFT JOIN feeds f ON f.id=ifd.feed_id
        WHERE i.title_norm=$title AND COALESCE(i.authors,'')=''
          AND COALESCE(i.year,'')=$year
        GROUP BY i.id
        ORDER BY i.id DESC
        `,
        { $title: item.titleNorm, $year: item.year },
      );
      const compatibleRows = rows.filter((row) =>
        this.publisherIdentitiesDoNotConflict(textValue(row.link), item.link)
      );
      const exact = compatibleRows.filter((row) =>
        this.journalCandidates(row).includes(item.journal)
      );
      if (exact.length === 1) {
        return Number(exact[0]?.id);
      }
      if (
        compatibleRows.length === 1 &&
        this.journalCandidates(compatibleRows[0]!).length === 0
      ) {
        return Number(compatibleRows[0]?.id);
      }
    }
    return null;
  }

  private databaseItemsByTitleAndLink(
    db: Database,
    item: ParsedItem,
  ): number[] {
    const statement = db.prepare(
      `SELECT id,link FROM items WHERE title_norm=$title AND link IS NOT NULL`,
    );
    statement.bind({ $title: item.titleNorm });
    const matches: number[] = [];
    const incomingPublisherIdentity = publisherIdentity(item.link);
    while (statement.step()) {
      const row = statement.getAsObject() as { id: number; link: string };
      const storedLink = textValue(row.link);
      if (
        canonicalizeLink(storedLink) === item.link ||
        (
          incomingPublisherIdentity &&
          publisherIdentity(storedLink) === incomingPublisherIdentity
        )
      ) {
        matches.push(Number(row.id));
      }
    }
    statement.free();
    return matches;
  }

  private journalCandidates(row: {
    article_journal?: SqlValue;
    feed_journals?: SqlValue;
  }): string[] {
    return [
      textValue(row.article_journal),
      ...textValue(row.feed_journals)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ].filter((value, index, values) => values.indexOf(value) === index);
  }

  private publisherIdentitiesDoNotConflict(
    storedLink: string,
    incomingLink: string,
  ): boolean {
    const storedIdentity = publisherIdentity(storedLink);
    const incomingIdentity = publisherIdentity(incomingLink);
    return !storedIdentity || !incomingIdentity ||
      storedIdentity === incomingIdentity;
  }

  private parsedItemParams(
    item: ParsedItem,
    id?: number,
  ): Record<string, unknown> {
    const title = cleanTitleText(item.title) || item.title;
    return {
      $id: id ?? null,
      $stableGuid: item.stableGuid,
      $title: title,
      $titleNorm: title === item.title ? item.titleNorm : normalizeText(title),
      $authors: item.authors,
      $journal: item.articleJournal?.trim() || null,
      $year: item.year,
      $doi: item.doi,
      $link: item.link,
      $pubDate: item.pubDate,
      $summary: item.summary,
      $imageUrl: item.imageUrl?.trim() || null,
    };
  }

  private translationParams(
    record: TranslationRecord,
  ): Record<string, unknown> {
    return {
      $itemId: record.itemId,
      $field: record.field,
      $sourceText: record.sourceText,
      $translatedText: record.translatedText === null ? null :
        translationInputText(record.field, record.translatedText),
      $sourceLanguage: record.sourceLanguage,
      $targetLanguage: record.targetLanguage,
      $provider: record.provider,
      $sourceHash: record.sourceHash,
      $sourceNormalized: translationInputText(record.field, record.sourceText),
      $status: record.status,
      $attemptCount: record.attemptCount,
      $lastError: record.lastError,
      $translatedAt: record.translatedAt,
    };
  }

  private singleValue(
    db: Database,
    sql: string,
    params: Record<string, unknown> = {},
  ): unknown {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      if (!statement.step()) {
        return null;
      }
      return statement.get()[0] ?? null;
    } finally {
      statement.free();
    }
  }

  private lastInsertId(db: Database): number {
    return Number(this.singleValue(db, "SELECT last_insert_rowid()"));
  }

}
