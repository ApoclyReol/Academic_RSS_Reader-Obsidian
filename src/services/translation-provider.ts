import { requestUrl } from "obsidian";

import { t, tx } from "../i18n";

export interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage: string;
}

export interface TranslationProvider {
  readonly id: "google-web";
  translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<TranslationResult>;
}

export class GoogleWebTranslationProvider implements TranslationProvider {
  readonly id = "google-web" as const;

  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<TranslationResult> {
    const parameters = new URLSearchParams({
      client: "gtx",
      sl: sourceLanguage || "auto",
      tl: targetLanguage,
      dt: "t",
      q: text,
    });
    const response = await requestUrl({
      url: `https://translate.googleapis.com/translate_a/single?${parameters.toString()}`,
      method: "GET",
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        tx(
          `翻译服务返回 HTTP ${response.status}`,
          `Translation service returned HTTP ${response.status}.`,
        ),
      );
    }
    const payload: unknown = response.json;
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      throw new Error(t("翻译服务返回了无法识别的数据"));
    }
    const fragments = payload[0] as unknown[];
    const translatedText = fragments
      .map((fragment) =>
        Array.isArray(fragment) && typeof fragment[0] === "string"
          ? fragment[0]
          : "",
      )
      .join("")
      .trim();
    if (!translatedText) {
      throw new Error(t("翻译结果为空"));
    }
    return {
      translatedText,
      detectedSourceLanguage:
        typeof payload[2] === "string" ? payload[2] : "auto",
    };
  }
}
