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

const CARD_DISPLAY_SETTING_KEYS = [
  "cardShowJournal",
  "cardShowAuthors",
  "cardShowPublicationDate",
  "cardShowDoi",
  "cardShowAbstract",
  "cardShowGraphicalAbstract",
] as const;

export function normalizeSettings(
  stored: Partial<RssReaderSettings>,
): RssReaderSettings {
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...stored,
  };
  for (const key of CARD_DISPLAY_SETTING_KEYS) {
    if (typeof stored[key] !== "boolean") {
      normalized[key] = DEFAULT_SETTINGS[key];
    }
  }
  if (!isSupportedTargetLanguage(stored.targetLanguage)) {
    normalized.targetLanguage = DEFAULT_SETTINGS.targetLanguage;
  }
  return normalized;
}

export function isSupportedTargetLanguage(
  value: unknown,
): value is TargetLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_TARGET_LANGUAGES as readonly string[]).includes(value)
  );
}
