export type AbstractTranslationMode = "on-open" | "manual" | "automatic";
export type TranslationDisplayMode =
  | "translated-first"
  | "original-first"
  | "both";

export interface RssReaderSettings {
  dataDirectory: string;
  autoUpdateOnStartup: boolean;
  hiddenExpireDays: number;
  targetLanguage: string;
  googleTranslationDisclosureAccepted: boolean;
  autoTranslateTitles: boolean;
  abstractTranslationMode: AbstractTranslationMode;
  translationDisplayMode: TranslationDisplayMode;
  pauseAutomaticTranslation: boolean;
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
  autoTranslateTitles: false,
  abstractTranslationMode: "manual",
  translationDisplayMode: "translated-first",
  pauseAutomaticTranslation: true,
  llmBaseUrl: "",
  llmSecretId: "",
  llmModel: "",
  userInterest: "",
};
