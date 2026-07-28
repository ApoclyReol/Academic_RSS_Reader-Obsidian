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
  autoTranslateTitles: boolean;
  abstractTranslationMode: AbstractTranslationMode;
  translationDisplayMode: TranslationDisplayMode;
  pauseAutomaticTranslation: boolean;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  userInterest: string;
}

export const DEFAULT_SETTINGS: RssReaderSettings = {
  dataDirectory: "",
  autoUpdateOnStartup: true,
  hiddenExpireDays: 30,
  targetLanguage: "zh-CN",
  autoTranslateTitles: false,
  abstractTranslationMode: "manual",
  translationDisplayMode: "translated-first",
  pauseAutomaticTranslation: true,
  llmBaseUrl: "",
  llmApiKey: "",
  llmModel: "",
  userInterest: "",
};
