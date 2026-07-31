import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

export type UiLanguage = "en" | "zh";
export type LocaleKey = keyof typeof en;
export type MessageParams = Readonly<Record<string, string | number>>;

let uiLanguage: UiLanguage = "zh";
const messages: Record<UiLanguage, Readonly<Record<string, string>>> = {
  en,
  zh: zhCN,
};

export function getUiLanguage(language?: string): UiLanguage {
  if (language === undefined) return uiLanguage;
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function setUiLanguage(language: string): void {
  uiLanguage = getUiLanguage(language);
}

export function t(key: LocaleKey, params: MessageParams = {}): string {
  const template = messages[getUiLanguage()][key] ?? en[key] ?? key;
  return template.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function plural(
  count: number,
  forms: { one: LocaleKey; other: LocaleKey },
  params: MessageParams = {},
): string {
  const category = new Intl.PluralRules(
    getUiLanguage() === "zh" ? "zh-CN" : "en",
  ).select(count);
  return t(category === "one" ? forms.one : forms.other, {
    ...params,
    count,
  });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(
    getUiLanguage() === "zh" ? "zh-CN" : "en",
  ).format(value);
}

export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(
        getUiLanguage() === "zh" ? "zh-CN" : "en",
        options,
      ).format(date);
}

export function hasEnglishTranslation(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(en, key);
}
