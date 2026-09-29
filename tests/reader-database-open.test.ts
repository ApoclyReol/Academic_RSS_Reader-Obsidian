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
