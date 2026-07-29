export const ITEM_STATUSES = [
  "unread",
  "interested",
  "archived",
  "hidden",
  "expired",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];
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
  url: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  itemCount: number;
}

export interface FeedInput {
  name: string;
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
  year: string;
  doi: string;
  link: string;
  pubDate: string;
  summary: string;
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
  year: string;
  doi: string;
  link: string;
  pubDate: string;
  summary: string;
}

export interface ItemQuery {
  status: ItemStatus;
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
  errorMessage: string | null;
}

export interface KeywordRecord {
  keyword: string;
  autoWeight: number;
  positiveCount: number;
  negativeCount: number;
  manualDirection: "positive" | "negative" | null;
  manualWeight: number | null;
  isDisabled: boolean;
  effectiveWeight: number;
}
