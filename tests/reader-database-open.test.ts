import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class MockPlugin {}
  class MockItemView {}
  class MockPluginSettingTab {}
  class MockAbstractInputSuggest<T> {
    setValue(_value: T): void {}
    close(): void {}
  }
  class MockModal {}
  class MockComponent {}
  class MockButtonComponent {}
  class MockSecretComponent {}
  class MockSetting {}
  class MockNotice {}

  return {
    requestUrl: vi.fn(),
    Plugin: MockPlugin,
    ItemView: MockItemView,
    PluginSettingTab: MockPluginSettingTab,
    AbstractInputSuggest: MockAbstractInputSuggest,
    Modal: MockModal,
    Component: MockComponent,
    ButtonComponent: MockButtonComponent,
    SecretComponent: MockSecretComponent,
    Setting: MockSetting,
    Notice: MockNotice,
    normalizePath: (path: string) => path,
    Platform: { isDesktop: true },
  };
});

import RssReaderPlugin from "../src/main";
import { DatabaseOperationCoordinator } from "../src/infrastructure/database-operation-coordinator";
import { DEFAULT_SETTINGS } from "../src/models/settings";

function createPlugin() {
  const plugin = Object.create(RssReaderPlugin.prototype) as RssReaderPlugin;
  const saved = vi.fn(async () => undefined);
  const renderedReady: boolean[] = [];
  const context = { database: { path: "Research/RSS/rss-reader.sqlite3" } };

  Object.assign(plugin, {
    settings: { ...DEFAULT_SETTINGS, dataDirectory: "Research/RSS", autoUpdateOnStartup: false },
    databaseState: "unconfigured",
    databaseError: null,
    context: null,
    settingTab: null,
    automaticUpdateStarted: false,
    lifecycleActive: false,
    lifecycleCompletion: null,
    unloading: false,
    operationCoordinator: new DatabaseOperationCoordinator(),
    saveData: saved,
  });
  vi.spyOn(plugin, "inspectDataDirectory").mockResolvedValue({
    exists: true,
    valid: true,
    error: null,
  });
  vi.spyOn(plugin, "refreshViews").mockImplementation(async () => {
    renderedReady.push(plugin.isDatabaseReady());
  });
  const buildContext = vi.fn(async () => context);
  Object.assign(plugin, { buildContext });

  return { plugin, saved, renderedReady, buildContext };
}

describe("reader database opening", () => {
  it("loads the saved directory when the reader opens", async () => {
    const { plugin, saved, renderedReady, buildContext } = createPlugin();

    plugin.prepareDatabaseOnViewOpen();
    expect(plugin.databaseState).toBe("initializing");
    await vi.waitFor(() => expect(plugin.isDatabaseReady()).toBe(true));
    await vi.waitFor(() =>
      expect(renderedReady[renderedReady.length - 1]).toBe(true),
    );

    expect(buildContext).toHaveBeenCalledOnce();
    expect(buildContext).toHaveBeenCalledWith(
      "Research/RSS/rss-reader.sqlite3",
      false,
    );
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({
      dataDirectory: "Research/RSS",
    }));
    expect(plugin.databaseError).toBeNull();
  });

  it("refreshes the reader after a manual load becomes usable", async () => {
    const { plugin, renderedReady } = createPlugin();

    await plugin.loadDatabase("Research/RSS");

    expect(plugin.isDatabaseReady()).toBe(true);
    expect(renderedReady).toEqual([false, true]);
  });
});

import { RssReaderView } from "../src/views/rss-reader-view";
import type { RssRepository } from "../src/repositories/rss-repository";

describe("title translation settings and cache coordination", () => {
  function readyPlugin() {
    const { plugin } = createPlugin();
    const repository = {} as RssRepository;
    const service = { clearTitleCache: vi.fn(async (): Promise<void> => undefined), setProvider: vi.fn(async (): Promise<void> => undefined) };
    const view = Object.create(RssReaderView.prototype) as RssReaderView;
    const reset = vi.spyOn(view, "resetTitleTranslationState").mockImplementation(() => undefined);
    const coordinator = new DatabaseOperationCoordinator();
    const context = { repository, translationService: service, translationConfiguration: "previous" };
    Object.assign(plugin, {
      context, databaseState: "ready", translationOperation: Promise.resolve(),
      operationCoordinator: coordinator,
      app: { workspace: { getLeavesOfType: () => [{ view }] } },
    });
    return { plugin, repository, service, reset, coordinator, refresh: vi.spyOn(plugin, "refreshViews") };
  }

  it("resets all readers to originals and blocks database transitions while clearing", async () => {
    const { plugin, repository, service, reset, coordinator, refresh } = readyPlugin();
    let finish!: () => void;
    service.clearTitleCache.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const clearing = plugin.clearTitleTranslationCache(repository);
    await vi.waitFor(() => expect(service.clearTitleCache).toHaveBeenCalledOnce());
    expect(reset).toHaveBeenCalledWith(true);
    expect(() => coordinator.acquireTransition()).toThrow();
    finish();
    await clearing;
    expect(refresh).toHaveBeenCalled();
    const release = coordinator.acquireTransition();
    release();
  });

  it("rejects a cache confirmation for a previously selected database", async () => {
    const { plugin, service } = readyPlugin();
    await expect(plugin.clearTitleTranslationCache({} as RssRepository)).rejects.toThrow("数据库已改变");
    expect(service.clearTitleCache).not.toHaveBeenCalled();
  });

  it("applies provider changes once and preserves the cache", async () => {
    const { plugin, service, reset } = readyPlugin();
    await plugin.saveSettings(false);
    expect(service.setProvider).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledWith(false);
    await plugin.saveSettings(false);
    expect(service.setProvider).toHaveBeenCalledOnce();
    plugin.settings.translationProvider = "llm";
    await plugin.saveSettings(false);
    expect(service.setProvider).toHaveBeenCalledTimes(2);
    expect(service.clearTitleCache).not.toHaveBeenCalled();
  });
});

import { requestUrl, type RequestUrlResponse } from "obsidian";
import { Window as HappyWindow } from "happy-dom";

it("tests LLM translation without opening a database", async () => {
  const { plugin, buildContext } = createPlugin();
  const window = new HappyWindow();
  Object.assign(plugin, { app: {
    workspace: { containerEl: window.document.body },
    secretStorage: { getSecret: (id: string) => id === "translation-key" ? "secret" : "" },
  } });
  Object.assign(plugin.settings, {
    translationProvider: "llm", translationLlmBaseUrl: "https://example.com/v1",
    translationLlmModel: "translator", translationLlmSecretId: "translation-key",
  });
  vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { choices: [{ message: { content: "科学传播中信任的作用" } }] } } as RequestUrlResponse);
  expect(await plugin.testTitleTranslation()).toBe("科学传播中信任的作用");
  expect(buildContext).not.toHaveBeenCalled();
  expect(plugin.isDatabaseReady()).toBe(false);
});
