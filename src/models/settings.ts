export interface RssReaderSettings {
  dataDirectory: string;
  autoUpdateOnStartup: boolean;
  hiddenExpireDays: number;
  cardShowJournal: boolean;
  cardShowAuthors: boolean;
  cardShowPublicationDate: boolean;
  cardShowDoi: boolean;
  cardShowAbstract: boolean;
  cardShowGraphicalAbstract: boolean;
  targetLanguage: TargetLanguage;
  googleTranslationDisclosureAccepted: boolean;
  llmBaseUrl: string;
  llmSecretId: string;
  llmModel: string;
  userInterest: string;
  recommendationLowThreshold: number | null;
  recommendationHighThreshold: number | null;
}

export const SUPPORTED_TARGET_LANGUAGES = [
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "it",
  "ru",
] as const;

export type TargetLanguage = (typeof SUPPORTED_TARGET_LANGUAGES)[number];

export const DEFAULT_SETTINGS: RssReaderSettings = {
  dataDirectory: "",
  autoUpdateOnStartup: true,
  hiddenExpireDays: 30,
  cardShowJournal: true,
  cardShowAuthors: false,
  cardShowPublicationDate: false,
  cardShowDoi: false,
  cardShowAbstract: false,
  cardShowGraphicalAbstract: true,
  targetLanguage: "zh-CN",
  googleTranslationDisclosureAccepted: false,
  llmBaseUrl: "",
  llmSecretId: "",
  llmModel: "",
  userInterest: "",
  recommendationLowThreshold: null,
  recommendationHighThreshold: null,
};

export function normalizeSettings(
  stored: Partial<RssReaderSettings>,
): RssReaderSettings {
  const stringValue = (value: unknown, fallback: string): string =>
    typeof value === "string" ? value : fallback;
  const booleanValue = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;
  const positiveIntegerValue = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1
      ? value
      : fallback;
  const thresholdValue = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;

  return {
    dataDirectory: stringValue(
      stored.dataDirectory,
      DEFAULT_SETTINGS.dataDirectory,
    ),
    autoUpdateOnStartup: booleanValue(
      stored.autoUpdateOnStartup,
      DEFAULT_SETTINGS.autoUpdateOnStartup,
    ),
    hiddenExpireDays: positiveIntegerValue(
      stored.hiddenExpireDays,
      DEFAULT_SETTINGS.hiddenExpireDays,
    ),
    cardShowJournal: booleanValue(
      stored.cardShowJournal,
      DEFAULT_SETTINGS.cardShowJournal,
    ),
    cardShowAuthors: booleanValue(
      stored.cardShowAuthors,
      DEFAULT_SETTINGS.cardShowAuthors,
    ),
    cardShowPublicationDate: booleanValue(
      stored.cardShowPublicationDate,
      DEFAULT_SETTINGS.cardShowPublicationDate,
    ),
    cardShowDoi: booleanValue(stored.cardShowDoi, DEFAULT_SETTINGS.cardShowDoi),
    cardShowAbstract: booleanValue(
      stored.cardShowAbstract,
      DEFAULT_SETTINGS.cardShowAbstract,
    ),
    cardShowGraphicalAbstract: booleanValue(
      stored.cardShowGraphicalAbstract,
      DEFAULT_SETTINGS.cardShowGraphicalAbstract,
    ),
    targetLanguage: isSupportedTargetLanguage(stored.targetLanguage)
      ? stored.targetLanguage
      : DEFAULT_SETTINGS.targetLanguage,
    googleTranslationDisclosureAccepted: booleanValue(
      stored.googleTranslationDisclosureAccepted,
      DEFAULT_SETTINGS.googleTranslationDisclosureAccepted,
    ),
    llmBaseUrl: stringValue(stored.llmBaseUrl, DEFAULT_SETTINGS.llmBaseUrl).trim(),
    llmSecretId: stringValue(stored.llmSecretId, DEFAULT_SETTINGS.llmSecretId).trim(),
    llmModel: stringValue(stored.llmModel, DEFAULT_SETTINGS.llmModel).trim(),
    userInterest: stringValue(stored.userInterest, DEFAULT_SETTINGS.userInterest).trim(),
    recommendationLowThreshold: thresholdValue(
      stored.recommendationLowThreshold,
    ),
    recommendationHighThreshold: thresholdValue(
      stored.recommendationHighThreshold,
    ),
  };
}

export function isSupportedTargetLanguage(
  value: unknown,
): value is TargetLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_TARGET_LANGUAGES as readonly string[]).includes(value)
  );
}
