import { requestUrl } from "obsidian";

import { t } from "../i18n";
import type {
  Feed,
  FeedInput,
  UpdateResult,
} from "../models/domain";
import type { RssReaderSettings } from "../models/settings";
import { RssRepository } from "../repositories/rss-repository";
import type { DatabaseOperationCoordinator } from "./database-operation-coordinator";
import { parseFeed } from "./rss-parser";
import {
  nextAutomaticAttempt,
  parseRetryAfter,
} from "./feed-scheduling";

export interface FeedUpdateHooks {
  onSettingsChanged(): Promise<void>;
  onFeedsUpdated(): Promise<void>;
}

export interface FeedUpdateProgress {
  completed: number;
  total: number;
  feedName: string;
}

export interface FeedUpdateOptions {
  automatic?: boolean;
  onProgress?: (progress: FeedUpdateProgress) => void;
}

interface FetchResult {
  status: number;
  text: string;
  etag: string | null;
  lastModified: string | null;
}

export class FeedService {
  private updateInProgress = false;
  private updateGeneration = 0;

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

  cancelUpdates(): void {
    this.updateGeneration += 1;
  }

  validateFeed(input: FeedInput): FeedInput {
    const name = input.name.trim();
    const url = input.url.trim();
    if (!name) {
      throw new Error(t("ui.feed_name_cannot_be_empty"));
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(t("ui.the_rss_url_must_be_a_valid_http_or_https_url"));
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(t("ui.the_rss_url_must_be_a_valid_http_or_https_url"));
    }
    return { name, url, enabled: input.enabled };
  }

  async addFeed(input: FeedInput): Promise<number> {
    return this.repository.addFeed(this.validateFeed(input));
  }

  async updateFeed(feedId: number, input: FeedInput): Promise<void> {
    await this.repository.updateFeed(feedId, this.validateFeed(input));
  }

  async updateFeeds(
    feedIds?: number[],
    options: FeedUpdateOptions = {},
  ): Promise<UpdateResult[]> {
    if (this.updateInProgress) {
      throw new Error(t("ui.a_feed_update_is_already_in_progress"));
    }
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("feed-update");
    this.updateInProgress = true;
    const generation = ++this.updateGeneration;
    const startedAt = new Date().toISOString();
    try {
      const now = Date.now();
      const feeds = this.repository
        .listFeeds(true)
        .filter((feed) =>
          feedIds ? feedIds.includes(feed.id) : feed.enabled,
        )
        .filter(
          (feed) =>
            !options.automatic ||
            !feed.nextAutoUpdateAt ||
            Date.parse(feed.nextAutoUpdateAt) <= now,
        );
      const results = await this.updateConcurrently(
        feeds,
        generation,
        options.onProgress,
      );
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
      await this.hooks.onFeedsUpdated();
      await this.hooks.onSettingsChanged();
      return results;
    } finally {
      this.updateInProgress = false;
      releaseOperation?.();
    }
  }

  private async updateConcurrently(
    feeds: Feed[],
    generation: number,
    onProgress?: (progress: FeedUpdateProgress) => void,
  ): Promise<UpdateResult[]> {
    const groups = new Map<string, Feed[]>();
    for (const feed of feeds) {
      const host = new URL(feed.url).hostname.toLocaleLowerCase();
      const group = groups.get(host) ?? [];
      group.push(feed);
      groups.set(host, group);
    }
    const hosts = [...groups.keys()];
    const results = new Map<number, UpdateResult>();
    let completed = 0;
    const worker = async (): Promise<void> => {
      while (hosts.length > 0 && generation === this.updateGeneration) {
        const host = hosts.shift();
        if (!host) {
          return;
        }
        const group = groups.get(host) ?? [];
        for (const feed of group) {
          if (generation !== this.updateGeneration) {
            break;
          }
          const result = await this.updateOne(feed, generation);
          results.set(feed.id, result);
          completed += 1;
          onProgress?.({
            completed,
            total: feeds.length,
            feedName: feed.name,
          });
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(4, hosts.length) },
        async () => worker(),
      ),
    );
    for (const feed of feeds) {
      if (!results.has(feed.id)) {
        results.set(
          feed.id,
          this.emptyResult(feed.id, feed.name, null, true),
        );
      }
    }
    return feeds.map((feed) => results.get(feed.id)!);
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

  private async updateOne(
    feed: Feed,
    generation: number,
  ): Promise<UpdateResult> {
    try {
      const response = await this.fetchWithRetry(feed, generation);
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
      if (response.status === 304) {
        await this.repository.updateFeedCheck(feed.id, null, {
          success: true,
          etag: response.etag,
          lastModified: response.lastModified,
        });
        return {
          ...this.emptyResult(feed.id, feed.name, null),
          notModified: true,
        };
      }
      const parsed = parseFeed(response.text, feed.name);
      const stored = await this.repository.upsertParsedItems(
        feed.id,
        parsed.items,
      );
      await this.repository.updateFeedCheck(feed.id, null, {
        success: true,
        etag: response.etag,
        lastModified: response.lastModified,
      });
      return {
        feedId: feed.id,
        feedName: feed.name,
        fetched: parsed.items.length,
        newItems: stored.insertedIds.length,
        duplicateHits: stored.duplicateHits,
        newFeedLinks: stored.newFeedLinks,
        notModified: false,
        cancelled: false,
        error: null,
      };
    } catch (error) {
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
      const message = error instanceof Error ? error.message : String(error);
      const failureCount = feed.consecutiveFailures + 1;
      await this.repository.updateFeedCheck(feed.id, message, {
        nextAutoUpdateAt: nextAutomaticAttempt(failureCount),
      });
      return this.emptyResult(feed.id, feed.name, message);
    }
  }

  private async fetchWithRetry(
    feed: Feed,
    generation: number,
  ): Promise<FetchResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (generation !== this.updateGeneration) {
        throw new Error(t("ui.feed_update_cancelled"));
      }
      try {
        const headers: Record<string, string> = {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "User-Agent": "Academic-RSS-Reader/1.3.0",
        };
        if (feed.etag) {
          headers["If-None-Match"] = feed.etag;
        }
        if (feed.lastModified) {
          headers["If-Modified-Since"] = feed.lastModified;
        }
        const response = await withTimeout(requestUrl({
          url: feed.url,
          method: "GET",
          headers,
          throw: false,
        }), 20_000, this.timerWindow);
        if (
          response.status === 304 ||
          (response.status >= 200 && response.status < 300)
        ) {
          return {
            status: response.status,
            text: response.text,
            etag: header(response.headers, "etag"),
            lastModified: header(response.headers, "last-modified"),
          };
        }
        const retryable = [408, 429, 500, 502, 503, 504].includes(
          response.status,
        );
        if (!retryable) {
          throw new NonRetryableError(`HTTP ${response.status}`);
        }
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < 2) {
          const retryAfter = [429, 503].includes(response.status)
            ? parseRetryAfter(header(response.headers, "retry-after"))
            : null;
          await delay(
            retryAfter ?? 1_000 * 2 ** attempt,
            this.timerWindow,
          );
        }
      } catch (error) {
        lastError = error;
        if (error instanceof NonRetryableError) {
          break;
        }
        if (attempt < 2) {
          await delay(1_000 * 2 ** attempt, this.timerWindow);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(t("ui.failed_to_fetch_feed"));
  }

  private emptyResult(
    feedId: number,
    feedName: string,
    error: string | null,
    cancelled = false,
  ): UpdateResult {
    return {
      feedId,
      feedName,
      fetched: 0,
      newItems: 0,
      duplicateHits: 0,
      newFeedLinks: 0,
      notModified: false,
      cancelled,
      error,
    };
  }
}

class NonRetryableError extends Error {}
class HttpTimeoutError extends Error {}

function header(
  headers: Record<string, string>,
  name: string,
): string | null {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLocaleLowerCase() === name,
  );
  return entry?.[1] ?? null;
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  timerWindow: Pick<Window, "setTimeout">,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    timerWindow.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new HttpTimeoutError(t("ui.feed_request_timed_out")));
      }
    }, milliseconds);
    void promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
    );
  });
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
