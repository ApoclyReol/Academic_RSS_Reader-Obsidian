import { requestUrl } from "obsidian";

import { t } from "../i18n";
import type {
  FeedInput,
  UpdateResult,
} from "../models/domain";
import type { RssReaderSettings } from "../models/settings";
import { RssRepository } from "../repositories/rss-repository";
import type { DatabaseOperationCoordinator } from "./database-operation-coordinator";
import { parseFeed } from "./rss-parser";

export interface FeedUpdateHooks {
  onSettingsChanged(): Promise<void>;
}

export class FeedService {
  private updateInProgress = false;

  constructor(
    private readonly repository: RssRepository,
    private readonly getSettings: () => RssReaderSettings,
    private readonly hooks: FeedUpdateHooks,
    private readonly timerWindow: Pick<Window, "setTimeout">,
    private readonly operationCoordinator?: DatabaseOperationCoordinator,
  ) {}

  isUpdating(): boolean {
    return this.updateInProgress;
  }

  validateFeed(input: FeedInput): FeedInput {
    const name = input.name.trim();
    const url = input.url.trim();
    if (!name) {
      throw new Error(t("订阅名称不能为空"));
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(t("RSS URL 必须是有效的 http/https 链接"));
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(t("RSS URL 必须是有效的 http/https 链接"));
    }
    return { name, url, enabled: input.enabled };
  }

  async addFeed(input: FeedInput): Promise<number> {
    return this.repository.addFeed(this.validateFeed(input));
  }

  async updateFeed(feedId: number, input: FeedInput): Promise<void> {
    await this.repository.updateFeed(feedId, this.validateFeed(input));
  }

  async updateFeeds(feedIds?: number[]): Promise<UpdateResult[]> {
    if (this.updateInProgress) {
      throw new Error(t("已有订阅更新正在进行"));
    }
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("feed-update");
    this.updateInProgress = true;
    const startedAt = new Date().toISOString();
    try {
      const feeds = this.repository
        .listFeeds(true)
        .filter((feed) =>
          feedIds ? feedIds.includes(feed.id) : feed.enabled,
        );
      const results: UpdateResult[] = [];
      for (const feed of feeds) {
        results.push(await this.updateOne(feed.id));
      }
      const cutoff = new Date(
        Date.now() -
          Math.max(1, this.getSettings().hiddenExpireDays) * 86_400_000,
      ).toISOString();
      const expired = await this.repository.expireHiddenBefore(cutoff);
      await this.repository.setMetadata(
        "last_update_summary",
        JSON.stringify({
          startedAt,
          finishedAt: new Date().toISOString(),
          totalFeeds: results.length,
          successFeeds: results.filter((result) => !result.error).length,
          totalNewItems: results.reduce(
            (sum, result) => sum + result.newItems,
            0,
          ),
          expiredItems: expired,
          results,
        }),
      );
      await this.hooks.onSettingsChanged();
      return results;
    } finally {
      this.updateInProgress = false;
      releaseOperation?.();
    }
  }

  parseImportText(text: string): FeedInput[] {
    const decoded = decodeXmlEntities(text);
    const candidates: FeedInput[] = [];
    const outlinePattern = /<outline\b[^>]*>/gi;
    for (const match of decoded.matchAll(outlinePattern)) {
      const tag = match[0];
      const url = attribute(tag, "xmlUrl") || attribute(tag, "url");
      if (!url) {
        continue;
      }
      const name =
        attribute(tag, "text") || attribute(tag, "title") || url;
      candidates.push({ name, url, enabled: true });
    }
    for (const line of decoded.split(/\r?\n/)) {
      for (const rawUrl of line.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
        const url = rawUrl.replace(/[",;)\]}\\]+$/, "");
        const name =
          line.replace(rawUrl, "").replace(/^[\s,;:：|—-]+|[\s,;]+$/g, "") ||
          url;
        candidates.push({ name, url, enabled: true });
      }
    }
    const unique = new Map<string, FeedInput>();
    for (const candidate of candidates) {
      try {
        const valid = this.validateFeed(candidate);
        unique.set(valid.url, valid);
      } catch {
        // Invalid candidates are omitted from preview.
      }
    }
    return [...unique.values()];
  }

  async importFeeds(
    candidates: FeedInput[],
  ): Promise<{ added: number; skipped: number; errors: string[] }> {
    const existing = new Set(
      this.repository.listFeeds(true).map((feed) => feed.url),
    );
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const candidate of candidates) {
      if (existing.has(candidate.url)) {
        skipped += 1;
        continue;
      }
      try {
        await this.addFeed(candidate);
        existing.add(candidate.url);
        added += 1;
      } catch (error) {
        errors.push(
          `${candidate.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { added, skipped, errors };
  }

  private async updateOne(feedId: number): Promise<UpdateResult> {
    const feed = this.repository.getFeed(feedId);
    if (!feed) {
      return this.emptyResult(feedId, "", t("订阅不存在"));
    }
    try {
      const content = await this.fetchWithRetry(feed.url);
      const parsed = parseFeed(content, feed.name);
      const stored = await this.repository.upsertParsedItems(
        feedId,
        parsed.items,
      );
      return {
        feedId,
        feedName: feed.name,
        fetched: parsed.items.length,
        newItems: stored.insertedIds.length,
        duplicateHits: stored.duplicateHits,
        newFeedLinks: stored.newFeedLinks,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.updateFeedCheck(feedId, message);
      return this.emptyResult(feedId, feed.name, message);
    }
  }

  private async fetchWithRetry(url: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await requestUrl({
          url,
          method: "GET",
          headers: {
            Accept:
              "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
            "User-Agent": "Academic-RSS-Reader/1.1.0",
          },
          throw: false,
        });
        if (response.status >= 200 && response.status < 300) {
          return response.text;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await delay(1_000 * 2 ** attempt, this.timerWindow);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(t("订阅获取失败"));
  }

  private emptyResult(
    feedId: number,
    feedName: string,
    error: string,
  ): UpdateResult {
    return {
      feedId,
      feedName,
      fetched: 0,
      newItems: 0,
      duplicateHits: 0,
      newFeedLinks: 0,
      error,
    };
  }
}

function attribute(tag: string, name: string): string {
  const match = tag.match(
    new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  return match?.[1]?.trim() ?? "";
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function delay(
  milliseconds: number,
  timerWindow: Pick<Window, "setTimeout">,
): Promise<void> {
  return new Promise((resolve) =>
    timerWindow.setTimeout(resolve, milliseconds),
  );
}
