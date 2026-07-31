export interface RssReaderSettings {
  dataDirectory: string;
  autoUpdateOnStartup: boolean;
  hiddenExpireDays: number;
  targetLanguage: string;
  googleTranslationDisclosureAccepted: boolean;
  llmBaseUrl: string;
  llmSecretId: string;
  llmModel: string;
  userInterest: string;
  recommendationLowThreshold: number | null;
  recommendationHighThreshold: number | null;
}

export const DEFAULT_SETTINGS: RssReaderSettings = {
  dataDirectory: "",
  autoUpdateOnStartup: true,
  hiddenExpireDays: 30,
  targetLanguage: "zh-CN",
  googleTranslationDisclosureAccepted: false,
  llmBaseUrl: "",
  llmSecretId: "",
  llmModel: "",
  userInterest: "",
  recommendationLowThreshold: null,
  recommendationHighThreshold: null,
};
