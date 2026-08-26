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
import {
  MAX_FEED_XML_BYTES,
  parseFeed,
  validateFeedXml,
} from "./rss-parser";
import {
  nextAutomaticAttempt,
  parseRetryAfter,
} from "./feed-scheduling";

export interface FeedUpdateHooks {
  onSettingsChanged(): Promise<void>;
  onFeedsUpdated(): Promise<void>;
  onCancelled?(): void;
}

export interface FeedUpdateProgress {
  completed: number;
  total: number;
  feedName: string;
}

export interface FeedUpdateOptions {
  automatic?: boolean;
  onProgress?: (progress: FeedUpdateProgress) => void;
  onSkipped?: (count: number) => void;
}

type TimerWindow = Pick<Window, "setTimeout"> &
  Partial<Pick<Window, "clearTimeout">>;

interface FetchResult {
  status: number;
  text: string;
  etag: string | null;
  lastModified: string | null;
}

const RECENT_AUTOMATIC_SUCCESS_WINDOW_MS = 60 * 60 * 1000;

export class FeedService {
  private updateInProgress = false;
  private updateGeneration = 0;
  private activeUpdate: Promise<UpdateResult[]> | null = null;

  constructor(
    private readonly repository: RssRepository,
    private readonly getSettings: () => RssReaderSettings,
    private readonly hooks: FeedUpdateHooks,
    private readonly timerWindow: TimerWindow,
    private readonly operationCoordinator?: DatabaseOperationCoordinator,
  ) {}

  isUpdating(): boolean {
    return this.updateInProgress;
  }

  cancelUpdates(): void {
    this.updateGeneration += 1;
    this.hooks.onCancelled?.();
  }

  async stop(): Promise<void> {
    this.cancelUpdates();
    await this.activeUpdate?.catch(() => undefined);
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
    return {
      name,
      journalName: input.journalName?.trim() || name,
      url,
      enabled: input.enabled,
    };
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
    this.updateInProgress = true;
    const generation = ++this.updateGeneration;
    const update = this.updateFeedsInternal(
      feedIds,
      options,
      generation,
    );
    this.activeUpdate = update;
    try {
      return await update;
    } finally {
      if (this.activeUpdate === update) {
        this.activeUpdate = null;
      }
      this.updateInProgress = false;
    }
  }

  private async updateFeedsInternal(
    feedIds: number[] | undefined,
    options: FeedUpdateOptions,
    generation: number,
  ): Promise<UpdateResult[]> {
    const releaseOperation =
      this.operationCoordinator?.acquireOperation("feed-update");
    const startedAt = new Date().toISOString();
    try {
      const now = Date.now();
      const candidates = this.repository
        .listFeeds(true)
        .filter((feed) =>
          feedIds ? feedIds.includes(feed.id) : feed.enabled,
        );
      const recentlyUpdated = options.automatic
        ? candidates.filter((feed) => this.wasRecentlySuccessful(feed, now))
        : [];
      const recentlyUpdatedIds = new Set(
        recentlyUpdated.map((feed) => feed.id),
      );
      const feeds = candidates.filter((feed) =>
        !options.automatic ||
        (
          !recentlyUpdatedIds.has(feed.id) &&
          (
            !feed.nextAutoUpdateAt ||
            Date.parse(feed.nextAutoUpdateAt) <= now
          )
        )
      );
      options.onSkipped?.(recentlyUpdated.length);
      if (feeds.length === 0) {
        return [];
      }
      const results = await this.updateConcurrently(
        feeds,
        generation,
        options.onProgress,
      );
      if (generation !== this.updateGeneration) {
        return results;
      }
      const cutoff = new Date(
        Date.now() -
          Math.max(1, this.getSettings().hiddenExpireDays) * 86_400_000,
      ).toISOString();
      const expired = await this.repository.expireHiddenBefore(cutoff);
      if (generation !== this.updateGeneration) {
        return results;
      }
      await this.repository.setMetadata(
        "last_update_summary",
        JSON.stringify({
          startedAt,
          finishedAt: new Date().toISOString(),
          totalFeeds: results.length,
          recentlyUpdatedSkippedFeeds: recentlyUpdated.length,
          successFeeds: results.filter(
            (result) => !result.error && !result.cancelled,
          ).length,
          totalNewItems: results.reduce(
            (sum, result) => sum + result.newItems,
            0,
          ),
          expiredItems: expired,
          results,
        }),
      );
      if (generation !== this.updateGeneration) {
        return results;
      }
      await this.hooks.onFeedsUpdated();
      if (generation !== this.updateGeneration) {
        return results;
      }
      await this.hooks.onSettingsChanged();
      return results;
    } finally {
      releaseOperation?.();
    }
  }

  private wasRecentlySuccessful(feed: Feed, now: number): boolean {
    if (!feed.lastSuccessAt) {
      return false;
    }
    const lastSuccess = parseStoredTimestamp(feed.lastSuccessAt);
    const elapsed = now - lastSuccess;
    return Number.isFinite(lastSuccess) &&
      elapsed >= 0 &&
      elapsed < RECENT_AUTOMATIC_SUCCESS_WINDOW_MS;
  }

  private async updateConcurrently(
    feeds: Feed[],
    generation: number,
    onProgress?: (progress: FeedUpdateProgress) => void,
  ): Promise<UpdateResult[]> {
    const groups = new Map<string, Feed[]>();
    for (const feed of feeds) {
      let host: string;
      try {
        host = new URL(feed.url).hostname.toLocaleLowerCase();
      } catch {
        host = `invalid-${feed.id}`;
      }
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
    const candidates: FeedInput[] = [];
    const hasOutlines = /<outline\b/i.test(text);
    const outlinePattern = /<outline\b[^>]*>/gi;
    for (const match of text.matchAll(outlinePattern)) {
      const tag = match[0];
      const url = attribute(tag, "xmlUrl") || attribute(tag, "url");
      if (!url) {
        continue;
      }
      const name =
        attribute(tag, "text") || attribute(tag, "title") || url;
      candidates.push({ name, url, enabled: true });
    }
    if (!hasOutlines) {
      const decoded = decodeXmlEntities(text);
      for (const line of decoded.split(/\r?\n/)) {
        for (const rawUrl of line.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
          const url = rawUrl.replace(/[",;)\]}\\]+$/, "");
          const name =
            line.replace(rawUrl, "").replace(/^[\s,;:：|—-]+|[\s,;]+$/g, "") ||
            url;
          candidates.push({ name, url, enabled: true });
        }
      }
    }
    const unique = new Map<string, FeedInput>();
    for (const candidate of candidates) {
      try {
        const valid = this.validateFeed(candidate);
        if (!unique.has(valid.url)) {
          unique.set(valid.url, valid);
        }
      } catch {
        // Invalid candidates are omitted from preview.
      }
    }
    return [...unique.values()];
  }

  async importFeeds(
    candidates: FeedInput[],
  ): Promise<{
    added: number;
    repaired: number;
    skipped: number;
    errors: string[];
  }> {
    const existing = new Map(
      this.repository.listFeeds(true).map((feed) => [feed.url, feed]),
    );
    let added = 0;
    let repaired = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const current = existing.get(candidate.url);
        if (current) {
          if (
            isMalformedImportedName(current.name) ||
            isMalformedImportedName(current.journalName)
          ) {
            const valid = this.validateFeed(candidate);
            await this.repository.updateFeed(current.id, {
              ...valid,
              enabled: current.enabled,
            });
            existing.set(candidate.url, {
              ...current,
              name: valid.name,
              journalName: valid.journalName ?? valid.name,
            });
            repaired += 1;
          } else {
            skipped += 1;
          }
          continue;
        }
        await this.addFeed(candidate);
        added += 1;
      } catch (error) {
        errors.push(
          `${candidate.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { added, repaired, skipped, errors };
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
        if (generation !== this.updateGeneration) {
          return this.emptyResult(feed.id, feed.name, null, true);
        }
        await this.repository.updateFeedCheck(feed.id, null, {
          success: true,
          etag: response.etag,
          lastModified: response.lastModified,
        });
        if (generation !== this.updateGeneration) {
          return this.emptyResult(feed.id, feed.name, null, true);
        }
        return {
          ...this.emptyResult(feed.id, feed.name, null),
          notModified: true,
        };
      }
      validateFeedXml(response.text);
      const parsed = parseFeed(response.text, feed.name, feed.journalName);
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
      const stored = await this.repository.upsertParsedItems(
        feed.id,
        parsed.items,
      );
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
      if (
        parsed.title.trim() &&
        (
          isMalformedImportedName(feed.name) ||
          isMalformedImportedName(feed.journalName)
        )
      ) {
        await this.repository.updateFeed(feed.id, {
          name: isMalformedImportedName(feed.name)
            ? parsed.title.trim()
            : feed.name,
          journalName: isMalformedImportedName(feed.journalName)
            ? parsed.title.trim()
            : feed.journalName,
          url: feed.url,
          enabled: feed.enabled,
        });
      }
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
      await this.repository.updateFeedCheck(feed.id, null, {
        success: true,
        etag: response.etag,
        lastModified: response.lastModified,
      });
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
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
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
      const failureCount = feed.consecutiveFailures + 1;
      await this.repository.updateFeedCheck(feed.id, message, {
        nextAutoUpdateAt: nextAutomaticAttempt(failureCount),
      });
      if (generation !== this.updateGeneration) {
        return this.emptyResult(feed.id, feed.name, null, true);
      }
      return this.emptyResult(feed.id, feed.name, message);
    }
  }

  private async fetchWithRetry(
    feed: Feed,
    generation: number,
  ): Promise<FetchResult> {
    let feedUrl: URL;
    try {
      feedUrl = new URL(feed.url);
    } catch {
      throw new NonRetryableError(
        t("ui.the_rss_url_must_be_a_valid_http_or_https_url"),
      );
    }
    if (!["http:", "https:"].includes(feedUrl.protocol)) {
      throw new NonRetryableError(
        t("ui.the_rss_url_must_be_a_valid_http_or_https_url"),
      );
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (generation !== this.updateGeneration) {
        throw new Error(t("ui.feed_update_cancelled"));
      }
      try {
        const headers: Record<string, string> = {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "User-Agent": "Academic-RSS-Reader/1.6.0",
        };
        const hasMalformedMetadata =
          isMalformedImportedName(feed.name) ||
          isMalformedImportedName(feed.journalName);
        if (feed.etag && !hasMalformedMetadata) {
          headers["If-None-Match"] = feed.etag;
        }
        if (feed.lastModified && !hasMalformedMetadata) {
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
          if (
            response.status !== 304 &&
            new TextEncoder().encode(response.text).byteLength > MAX_FEED_XML_BYTES
          ) {
            throw new NonRetryableError(
              t("feed.response_too_large"),
            );
          }
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
          throw new NonRetryableError(t("feed.http_error", {
            status: response.status,
          }));
        }
        lastError = new Error(t("feed.http_error", {
          status: response.status,
        }));
        if (attempt < 2) {
          const retryAfter = [429, 503].includes(response.status)
            ? parseRetryAfter(header(response.headers, "retry-after"))
            : null;
          await delay(
            retryAfter ?? 1_000 * 2 ** attempt,
            this.timerWindow,
          );
          if (generation !== this.updateGeneration) {
            throw new Error(t("ui.feed_update_cancelled"));
          }
        }
      } catch (error) {
        lastError = error;
        if (error instanceof NonRetryableError) {
          break;
        }
        if (attempt < 2) {
          await delay(1_000 * 2 ** attempt, this.timerWindow);
          if (generation !== this.updateGeneration) {
            throw new Error(t("ui.feed_update_cancelled"));
          }
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

function parseStoredTimestamp(value: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return Date.parse(normalized);
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
  timerWindow: TimerWindow,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = timerWindow.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new HttpTimeoutError(t("ui.feed_request_timed_out")));
      }
    }, milliseconds);
    const clearTimeout = timerWindow.clearTimeout;
    const clear = () => {
      clearTimeout?.(timeout);
    };
    void promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clear();
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          clear();
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
  return decodeXmlEntities(match?.[1] ?? "").trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isMalformedImportedName(value: string): boolean {
  return /^(?:xmlUrl|htmlUrl)\s*=/i.test(value.trim());
}

function delay(
  milliseconds: number,
  timerWindow: TimerWindow,
): Promise<void> {
  return new Promise((resolve) => timerWindow.setTimeout(resolve, milliseconds));
}
