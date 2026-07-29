import { requestUrl } from "obsidian";

import { t, tx } from "../i18n";
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
      t("只回复 high，不要添加其他文字。"),
    );
    if (parseTier(response) !== "high") {
      throw new Error(t("服务已响应，但没有按要求返回 high"));
    }
    return t("连接、认证和模型响应正常");
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
              t("你正在帮助研究者筛选论文。"),
              `研究兴趣：${settings.userInterest || t("未补充")}`,
              tx(`标题：${item.title}`, `Title: ${item.title}`),
              tx(`摘要：${item.summary}`, `Abstract: ${item.summary}`),
              tx(
                `关键词分：${item.keywordScore ?? 50}`,
                `Keyword score: ${item.keywordScore ?? 50}`,
              ),
              t("判断论文是否值得优先阅读。只能返回 high 或 low。"),
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
      throw new Error(t("请先配置 LLM 地址、API Key 和模型"));
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
      throw new Error(
        tx(
          `LLM 请求失败：HTTP ${response.status}`,
          `LLM request failed: HTTP ${response.status}`,
        ),
      );
    }
    const payload = response.json as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(t("LLM 返回内容为空"));
    }
    return content;
  }
}
