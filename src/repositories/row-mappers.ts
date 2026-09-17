import { t } from "../i18n";
import {
  ITEM_STATUSES,
  type Feed,
  type ItemStatus,
  type RssItem,
  type TranslationField,
  type TranslationRecord,
  type TranslationStatus,
} from "../models/domain";
import {
  feedDisplayMetadata,
  textValue,
  type RepositoryRow,
} from "./repository-helpers";

export function toFeed(row: RepositoryRow): Feed {
  const inferredJournal = textValue(row.inferred_journal);
  const feedUrl = textValue(row.url);
  const name = textValue(row.name);
  const journalName = textValue(row.journal_name ?? row.name);
  return {
    id: Number(row.id),
    name,
    journalName,
    displayJournalName: feedDisplayMetadata(
      journalName,
      inferredJournal,
      feedUrl,
    ),
    url: feedUrl,
    enabled: Boolean(row.enabled),
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
    lastCheckedAt: row.last_checked_at
      ? textValue(row.last_checked_at)
      : null,
    lastError: row.last_error ? textValue(row.last_error) : null,
    etag: row.etag ? textValue(row.etag) : null,
    lastModified: row.last_modified ? textValue(row.last_modified) : null,
    lastSuccessAt: row.last_success_at
      ? textValue(row.last_success_at)
      : null,
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    healthStatus: (row.health_status ?? "healthy") as Feed["healthStatus"],
    nextAutoUpdateAt: row.next_auto_update_at
      ? textValue(row.next_auto_update_at)
      : null,
    itemCount: Number(row.item_count ?? 0),
  };
}

export function toItem(row: RepositoryRow): RssItem {
  const status = textValue(row.item_status);
  if (!ITEM_STATUSES.includes(status as ItemStatus)) {
    throw new Error(t("database.unknown_item_status", { status }));
  }
  return {
    id: Number(row.id),
    stableGuid: textValue(row.stable_guid),
    title: textValue(row.title),
    titleNorm: textValue(row.title_norm),
    authors: textValue(row.authors),
    journal: textValue(row.journal ?? row.article_journal),
    feedNames: textValue(row.feed_names),
    year: textValue(row.year),
    doi: textValue(row.doi),
    link: textValue(row.link),
    pubDate: textValue(row.pub_date),
    summary: textValue(row.summary),
    imageUrl: row.image_url ? textValue(row.image_url) : null,
    firstSeenAt: textValue(row.first_seen_at),
    lastSeenAt: textValue(row.last_seen_at),
    itemStatus: status as ItemStatus,
    finalTier: row.final_tier
      ? (textValue(row.final_tier) as RssItem["finalTier"])
      : null,
    keywordScore:
      row.keyword_score === null || row.keyword_score === undefined
        ? null
        : Number(row.keyword_score),
    llmTier: row.llm_tier
      ? (textValue(row.llm_tier) as RssItem["llmTier"])
      : null,
    matchedKeywords: textValue(row.matched_keywords, "[]"),
    translatedTitle: row.translated_title
      ? textValue(row.translated_title)
      : null,
    translatedAbstract: row.translated_abstract
      ? textValue(row.translated_abstract)
      : null,
    titleTranslationStatus: row.title_translation_status
      ? (textValue(row.title_translation_status) as TranslationStatus)
      : null,
    abstractTranslationStatus: row.abstract_translation_status
      ? (textValue(row.abstract_translation_status) as TranslationStatus)
      : null,
  };
}

export function toTranslation(row: RepositoryRow): TranslationRecord {
  return {
    itemId: Number(row.item_id),
    field: textValue(row.field) as TranslationField,
    sourceText: textValue(row.source_text),
    translatedText: row.translated_text
      ? textValue(row.translated_text)
      : null,
    sourceLanguage: row.source_language
      ? textValue(row.source_language)
      : null,
    targetLanguage: textValue(row.target_language),
    provider: "google-web",
    sourceHash: textValue(row.source_hash),
    status: textValue(row.status) as TranslationStatus,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error ? textValue(row.last_error) : null,
    translatedAt:
      row.translated_at === null ? null : Number(row.translated_at),
  };
}
