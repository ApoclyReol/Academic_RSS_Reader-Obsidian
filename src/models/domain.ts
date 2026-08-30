export const ITEM_STATUSES = [
  "unread",
  "interested",
  "archived",
  "hidden",
  "expired",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemSort = "title" | "updated" | "journal" | "relevance";
export type RecommendationTier = "high" | "pending" | "low";
export type TranslationField = "title" | "abstract";
export type TranslationStatus =
  | "pending"
  | "translating"
  | "succeeded"
  | "failed";

export interface Feed {
  id: number;
  name: string;
  journalName: string;
  displayJournalName: string;
  url: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  etag: string | null;
  lastModified: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  healthStatus: "healthy" | "degraded" | "failing";
  nextAutoUpdateAt: string | null;
  itemCount: number;
}

export interface FeedInput {
  name: string;
  journalName?: string;
  url: string;
  enabled: boolean;
}

export interface RssItem {
  id: number;
  stableGuid: string;
  title: string;
  titleNorm: string;
  authors: string;
  journal: string;
  feedNames: string;
  year: string;
  doi: string;
  link: string;
  pubDate: string;
  summary: string;
  imageUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  itemStatus: ItemStatus;
  finalTier: RecommendationTier | null;
  keywordScore: number | null;
  llmTier: RecommendationTier | null;
  matchedKeywords: string;
  translatedTitle: string | null;
  translatedAbstract: string | null;
  titleTranslationStatus: TranslationStatus | null;
  abstractTranslationStatus: TranslationStatus | null;
}

export interface ParsedItem {
  stableGuid: string;
  title: string;
  titleNorm: string;
  authors: string;
  journal: string;
  /** RSS-provided article journal; empty/undefined means use feed defaults. */
  articleJournal?: string;
  year: string;
  doi: string;
  link: string;
  pubDate: string;
  summary: string;
  imageUrl?: string;
}

export interface ItemQuery {
  status: ItemStatus;
  sort?: ItemSort;
  query?: string;
  feedIds?: number[];
  limit?: number;
  offset?: number;
  targetLanguage?: string;
}

export interface TranslationRecord {
  itemId: number;
  field: TranslationField;
  sourceText: string;
  translatedText: string | null;
  sourceLanguage: string | null;
  targetLanguage: string;
  provider: "google-web";
  sourceHash: string;
  status: TranslationStatus;
  attemptCount: number;
  lastError: string | null;
  translatedAt: number | null;
}

export interface UpdateResult {
  feedId: number;
  feedName: string;
  fetched: number;
  newItems: number;
  duplicateHits: number;
  newFeedLinks: number;
  notModified: boolean;
  cancelled: boolean;
  error: string | null;
}

export interface RecommendationSummary {
  high: number;
  pending: number;
  low: number;
  unscored: number;
  modelVersion: string | null;
  positiveCount: number;
  negativeCount: number;
  unreadCount: number;
  createdAt: string | null;
  intercept: number;
  trainingHash: string | null;
  validationAccuracy: number | null;
  suggestedLowThreshold: number;
  suggestedHighThreshold: number;
  activeLowThreshold: number;
  activeHighThreshold: number;
  featureVersion: number;
  isStale: boolean;
  errorMessage: string | null;
}

export interface KeywordRecord {
  keyword: string;
  idf: number;
  autoWeight: number;
  positiveCount: number;
  negativeCount: number;
  isDisabled: boolean;
  effectiveWeight: number;
}
