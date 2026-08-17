import { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

import { requestUrl } from "obsidian";

import { RssDatabase } from "../src/database/database";
import { t } from "../src/i18n";
import { DEFAULT_SETTINGS } from "../src/models/settings";
import { RssRepository } from "../src/repositories/rss-repository";
import { FeedService } from "../src/services/feed-service";
import { MemoryAdapter } from "./helpers/memory-adapter";

const timerWindow = new HappyWindow() as unknown as Pick<
  Window,
  "setTimeout" | "clearTimeout"
>;
const VALID_EMPTY_RSS =
  "<rss version='2.0'><channel><title>Feed</title></channel></rss>";
const resources: Array<{ database: RssDatabase; adapter: MemoryAdapter }> = [];

describe("feed service lifecycle", () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  afterEach(async () => {
    for (const resource of resources) {
      await resource.database.drain().catch(() => undefined);
      resource.database.close();
      resource.adapter.dispose();
    }
    resources.length = 0;
  });

  it("records a valid HTTP response that is not RSS as a feed failure", async () => {
    const { repository } = await createRepository();
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: "<html><body>502 Bad Gateway</body></html>",
      headers: {},
      json: {},
    } as never);
    const hooks = createHooks();
    const service = new FeedService(
      repository,
      () => DEFAULT_SETTINGS,
      hooks,
      timerWindow,
    );

    const [result] = await service.updateFeeds();

    expect(result?.cancelled).toBe(false);
    expect(result?.error).toBe(t("feed.invalid_root"));
    expect(repository.countItems()).toBe(0);
    expect(hooks.onFeedsUpdated).toHaveBeenCalledOnce();
  });

  it("stores an RSS image without requesting the article page", async () => {
    const { repository } = await createRepository();
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<rss version="2.0"><channel><title>Feed</title><item>
        <title>Image paper</title>
        <link>https://example.com/article</link>
        <description><![CDATA[<p>Abstract</p><img src="https://cdn.example.com/figure.png"/>]]></description>
      </item></channel></rss>`,
      headers: {},
      json: {},
    } as never);
    const service = new FeedService(
      repository,
      () => DEFAULT_SETTINGS,
      createHooks(),
      timerWindow,
    );

    const [result] = await service.updateFeeds();

    expect(result?.error).toBeNull();
    expect(requestUrl).toHaveBeenCalledOnce();
    expect(repository.listItems({ status: "unread" })[0]?.imageUrl).toBe(
      "https://cdn.example.com/figure.png",
    );
  });

  it("imports only OPML feed URLs and preserves outline names", async () => {
    const { repository } = await createRepository();
    const service = new FeedService(
      repository,
      () => DEFAULT_SETTINGS,
      createHooks(),
      timerWindow,
    );

    const candidates = service.parseImportText(
      `<opml version="2.0"><body>
        <outline text="Publisher">
          <outline type="rss" text="Journal A"
            xmlUrl="https://example.com/a?one=1&amp;two=2"
            htmlUrl="https://example.com/journal/a" />
          <outline type="rss" text="Journal B"
            xmlUrl="https://example.com/b"
            htmlUrl="https://example.com/journal/b" />
        </outline>
      </body></opml>`,
    );

    expect(candidates).toEqual([
      {
        name: "Journal A",
        journalName: "Journal A",
        url: "https://example.com/a?one=1&two=2",
        enabled: true,
      },
      {
        name: "Journal B",
        journalName: "Journal B",
        url: "https://example.com/b",
        enabled: true,
      },
    ]);
  });

  it("repairs malformed names when the corrected OPML is imported again", async () => {
    const { repository } = await createRepository();
    await repository.updateFeed(1, {
      name: 'xmlUrl=""',
      journalName: 'xmlUrl=""',
      url: "https://example.com/feed",
      enabled: false,
    });
    const service = new FeedService(
      repository,
      () => DEFAULT_SETTINGS,
      createHooks(),
      timerWindow,
    );

    const result = await service.importFeeds([{
      name: "Correct journal",
      url: "https://example.com/feed",
      enabled: true,
    }]);

    expect(result).toEqual({
      added: 0,
      repaired: 1,
      skipped: 0,
      errors: [],
    });
    expect(repository.getFeed(1)).toMatchObject({
      name: "Correct journal",
      journalName: "Correct journal",
      enabled: false,
    });
  });

  it("fully refreshes and repairs malformed feed metadata instead of accepting a 304", async () => {
    const { repository } = await createRepository();
    await repository.updateFeed(1, {
      name: 'xmlUrl=""',
      journalName: 'xmlUrl=""',
      url: "https://example.com/feed",
      enabled: true,
    });
    await repository.updateFeedCheck(1, null, {
      success: true,
      etag: "stale-etag",
      lastModified: "Sat, 01 Aug 2026 00:00:00 GMT",
    });
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: `<rss version="2.0"><channel>
        <title>Recovered journal</title>
        <item><title>Recovered paper</title>
          <description>Source: Article journal Author(s): Alice</description>
        </item>
      </channel></rss>`,
      headers: {},
      json: {},
    } as never);
    const service = new FeedService(
      repository,
      () => DEFAULT_SETTINGS,
      createHooks(),
      timerWindow,
    );

    await service.updateFeeds();

    const request = vi.mocked(requestUrl).mock.calls[0]?.[0] as {
      headers?: Record<string, string>;
    };
    expect(request.headers).not.toHaveProperty("If-None-Match");
    expect(request.headers).not.toHaveProperty("If-Modified-Since");
    expect(repository.getFeed(1)).toMatchObject({
      name: "Recovered journal",
      journalName: "Recovered journal",
    });
    expect(repository.listItems({ status: "unread" })[0]).toMatchObject({
      authors: "Alice",
      journal: "Article journal",
    });
  });

  it("does not write or refresh after cancellation", async () => {
    const { repository } = await createRepository();
    let resolveRequest!: (response: unknown) => void;
    vi.mocked(requestUrl).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }) as never,
    );
    const hooks = createHooks();
    const service = new FeedService(
      repository,
      () => DEFAULT_SETTINGS,
      hooks,
      timerWindow,
    );

    const updating = service.updateFeeds();
    await vi.waitFor(() => expect(requestUrl).toHaveBeenCalledOnce());
    const stopping = service.stop();
    resolveRequest({
      status: 200,
      text: VALID_EMPTY_RSS,
      headers: {},
      json: {},
    });

    await stopping;
    const [result] = await updating;
    expect(result?.cancelled).toBe(true);
    expect(result?.error).toBeNull();
    expect(repository.countItems()).toBe(0);
    expect(hooks.onFeedsUpdated).not.toHaveBeenCalled();
    expect(hooks.onSettingsChanged).not.toHaveBeenCalled();
    expect(hooks.onCancelled).toHaveBeenCalledOnce();
  });

  it("skips recently successful feeds only during automatic updates", async () => {
    const { repository, database } = await createRepository();
    await repository.updateFeedCheck(1, null, { success: true });
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: VALID_EMPTY_RSS,
      headers: {},
      json: {},
    } as never);
    const hooks = createHooks();
    const service = new FeedService(
      repository,
      () => DEFAULT_SETTINGS,
      hooks,
      timerWindow,
    );
    const onSkipped = vi.fn();

    const automatic = await service.updateFeeds(undefined, {
      automatic: true,
      onSkipped,
    });
    expect(automatic).toEqual([]);
    expect(onSkipped).toHaveBeenCalledWith(1);
    expect(requestUrl).not.toHaveBeenCalled();
    expect(hooks.onFeedsUpdated).not.toHaveBeenCalled();
    expect(hooks.onSettingsChanged).not.toHaveBeenCalled();

    const manual = await service.updateFeeds();
    expect(manual).toHaveLength(1);
    expect(requestUrl).toHaveBeenCalledOnce();

    await database.write((db) => {
      db.run(
        "UPDATE feeds SET last_success_at=datetime('now','-61 minutes') WHERE id=1",
      );
    });
    const automaticAfterOneHour = await service.updateFeeds(undefined, {
      automatic: true,
      onSkipped,
    });
    expect(automaticAfterOneHour).toHaveLength(1);
    expect(onSkipped).toHaveBeenLastCalledWith(0);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });
});

async function createRepository(): Promise<{
  repository: RssRepository;
  database: RssDatabase;
  adapter: MemoryAdapter;
}> {
  const adapter = new MemoryAdapter();
  const database = new RssDatabase(adapter, "Data/rss-reader.sqlite3");
  await database.initialize();
  const repository = new RssRepository(database);
  await repository.addFeed({
    name: "Feed",
    url: "https://example.com/feed",
    enabled: true,
  });
  resources.push({ database, adapter });
  return { repository, database, adapter };
}

function createHooks() {
  return {
    onFeedsUpdated: vi.fn(async () => undefined),
    onSettingsChanged: vi.fn(async () => undefined),
    onCancelled: vi.fn(),
  };
}
