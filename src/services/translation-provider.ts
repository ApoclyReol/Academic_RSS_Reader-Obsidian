import { requestUrl, type RequestUrlResponse } from "obsidian";

import { t } from "../i18n";
import { TranslationRequestError } from "./translation-error";
export {
  TranslationRequestError,
  type TranslationErrorKind,
  type TranslationRequestErrorOptions,
} from "./translation-error";

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
    let response: RequestUrlResponse;
    try {
      response = await requestUrl({
        url: `https://translate.googleapis.com/translate_a/single?${parameters.toString()}`,
        method: "GET",
        throw: false,
      });
    } catch {
      throw new TranslationRequestError(
        t("ui.translation_network_error"),
        {
          kind: "network",
          retryable: true,
        },
      );
    }
    if (response.status < 200 || response.status >= 300) {
      const status = response.status;
      const retryable =
        status === 408 ||
        status === 425 ||
        status === 429 ||
        status >= 500;
      throw new TranslationRequestError(
        t("error.translation_http", { status }),
        {
          kind:
            status === 429
              ? "rate-limit"
              : status >= 500
                ? "server"
                : "client",
          retryable,
          retryAfterMs: retryAfterMilliseconds(response.headers ?? {}),
          status,
        },
      );
    }
    let payload: unknown;
    try {
      payload = response.json;
    } catch {
      throw new TranslationRequestError(
        t("ui.the_translation_service_returned_unrecognized_data"),
        {
          kind: "response",
          retryable: false,
        },
      );
    }
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      throw new TranslationRequestError(
        t("ui.the_translation_service_returned_unrecognized_data"),
        {
          kind: "response",
          retryable: false,
        },
      );
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
      throw new TranslationRequestError(
        t("ui.the_translation_result_is_empty"),
        {
          kind: "response",
          retryable: false,
        },
      );
    }
    return {
      translatedText,
      detectedSourceLanguage:
        typeof payload[2] === "string" ? payload[2] : "auto",
    };
  }
}

function retryAfterMilliseconds(
  headers: Record<string, string>,
): number | null {
  const value = Object.entries(headers).find(
    ([key]) => key.toLocaleLowerCase() === "retry-after",
  )?.[1]?.trim();
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
