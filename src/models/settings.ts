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
};
