import { requestUrl } from "obsidian";

import { t } from "../i18n";
import type { RssReaderSettings } from "../models/settings";
import { RssRepository } from "../repositories/rss-repository";
import type { DatabaseOperationCoordinator } from "./database-operation-coordinator";
import { parseTier } from "./relevance";

export interface LlmReviewRun {
  high: number;
  low: number;
  failed: number;
}

export class LlmService {
  constructor(
    private readonly repository: RssRepository,
    private readonly getSettings: () => RssReaderSettings,
    private readonly getApiKey: () => string,
    private readonly operationCoordinator?: DatabaseOperationCoordinator,
  ) {}

  async testConnection(): Promise<string> {
    const settings = this.validatedSettings();
    const response = await this.complete(
      settings,
      t("ui.reply_with_high_only_do_not_add_any_other_text"),
    );
    if (parseTier(response) !== "high") {
      throw new Error(t("ui.the_service_responded_but_did_not_return_high_as_requested"));
    }
    return t("ui.connection_authentication_and_model_response_are_working");
  }

  async reviewPending(): Promise<LlmReviewRun> {
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("llm-review");
    try {
      const settings = this.validatedSettings();
      const result: LlmReviewRun = { high: 0, low: 0, failed: 0 };
      for (const item of this.repository.listPendingLlmItems()) {
        try {
          const response = await this.complete(
            settings,
            [
              t("ui.you_are_helping_a_researcher_screen_papers"),
              `${t("ui.additional_research_interests")}: ${settings.userInterest || t("ui.not_provided")}`,
              t("dynamic.title", { title: item.title }),
              t("dynamic.abstract", { abstract: item.summary }),
              t("dynamic.keyword_score", {
                score: item.keywordScore ?? 50,
              }),
              t("ui.decide_whether_this_paper_deserves_priority_reading_return_high_or_low_o"),
            ].join("\n"),
          );
          const tier = parseTier(response);
          await this.repository.saveLlmReview(item.id, tier, null);
          result[tier] += 1;
        } catch (error) {
          result.failed += 1;
          await this.repository.saveLlmReview(
            item.id,
            null,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return result;
    } finally {
      releaseOperation?.();
    }
  }

  private validatedSettings(): RssReaderSettings {
    const settings = this.getSettings();
    if (!settings.llmBaseUrl || !this.getApiKey() || !settings.llmModel) {
      throw new Error(t("ui.configure_the_llm_endpoint_api_key_and_model_first"));
    }
    return settings;
  }

  private async complete(
    settings: RssReaderSettings,
    prompt: string,
  ): Promise<string> {
    const base = settings.llmBaseUrl.replace(/\/+$/, "");
    const url = base.endsWith("/v1")
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.llmModel,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(t("error.llm_http", { status: response.status }));
    }
    const payload = response.json as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(t("ui.the_llm_returned_an_empty_response"));
    }
    return content;
  }
}
