import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Window as HappyWindow } from "happy-dom";

vi.mock("obsidian", () => {
  class MockPluginSettingTab {
    app: unknown;

    constructor(app: unknown, _plugin: unknown) {
      this.app = app;
    }

    update(): void {}

    setControlValue(_key: string, _value: unknown): void {}
  }

  class MockAbstractInputSuggest<T> {
    constructor(..._args: unknown[]) {}

    close(): void {}

    setValue(_value: T): void {}
  }

  class MockSecretComponent {
    constructor(..._args: unknown[]) {}

    setValue(_value: string): this {
      return this;
    }

    onChange(_callback: (value: string) => void): this {
      return this;
    }
  }

  class MockSetting {}
  class MockNotice {}

  return {
    AbstractInputSuggest: MockAbstractInputSuggest,
    Notice: MockNotice,
    PluginSettingTab: MockPluginSettingTab,
    SecretComponent: MockSecretComponent,
    Setting: MockSetting,
  };
});

import type {
  App,
  SettingDefinitionControl,
  SettingDefinitionGroup,
  SettingGroupItem,
} from "obsidian";

import { RssReaderSettingTab } from "../src/settings/rss-reader-setting-tab";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  SUPPORTED_TARGET_LANGUAGES,
  type RssReaderSettings,
} from "../src/models/settings";
import type RssReaderPlugin from "../src/main";

describe("declarative settings", () => {
  it("exposes searchable controls and custom renderers", () => {
    const plugin = createPluginStub();
    const tab = new RssReaderSettingTab({} as App, plugin);

    const groups = tab
      .getSettingDefinitions()
      .filter(isSettingGroup);
    const items = groups.flatMap((group) => group.items ?? []);
    const controls = items.filter(isSettingControl);

    expect(groups.map((group) => group.heading)).toEqual([
      "数据库存储",
      "订阅更新",
      "文献卡片",
      "实验性网页翻译",
      "LLM 推荐复核",
    ]);
    expect(controls.map((item) => item.control.key)).toEqual([
      "autoUpdateOnStartup",
      "hiddenExpireDays",
      "cardShowJournal",
      "cardShowAuthors",
      "cardShowPublicationDate",
      "cardShowDoi",
      "cardShowAbstract",
      "cardShowGraphicalAbstract",
      "targetLanguage",
      "llmBaseUrl",
      "llmModel",
      "userInterest",
    ]);
    const translationControl = controls.find(
      (item) => item.control.key === "targetLanguage",
    )?.control;
    expect(translationControl && "options" in translationControl
      ? Object.keys(translationControl.options ?? {})
      : []).toEqual([...SUPPORTED_TARGET_LANGUAGES]);
    if (translationControl && "options" in translationControl) {
      for (const language of SUPPORTED_TARGET_LANGUAGES) {
        expect(translationControl.options[language]).toContain(`(${language})`);
      }
    }
    expect(items.filter((item) => "render" in item)).toHaveLength(6);
  });

  it("fills and normalizes paper-card defaults for stored settings", () => {
    const upgraded = normalizeSettings({
      targetLanguage: "en",
    });
    expect(upgraded).toMatchObject({
      cardShowJournal: true,
      cardShowAuthors: false,
      cardShowPublicationDate: false,
      cardShowDoi: false,
      cardShowAbstract: false,
      cardShowGraphicalAbstract: true,
    });

    const invalid = normalizeSettings({
      cardShowJournal: "false",
      cardShowAuthors: 1,
      cardShowPublicationDate: null,
      cardShowDoi: {},
      cardShowAbstract: [],
      cardShowGraphicalAbstract: "true",
      targetLanguage: "xx",
    } as unknown as Partial<RssReaderSettings>);
    expect(invalid).toMatchObject({
      cardShowJournal: true,
      cardShowAuthors: false,
      cardShowPublicationDate: false,
      cardShowDoi: false,
      cardShowAbstract: false,
      cardShowGraphicalAbstract: true,
      targetLanguage: "zh-CN",
    });
  });

  it("keeps normalized values when declarative controls save", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const plugin = createPluginStub({ saveSettings });
    const settingsWindow = new HappyWindow();
    const app = {
      workspace: { containerEl: settingsWindow.document.body },
    } as unknown as App;
    const tab = new RssReaderSettingTab(app, plugin);

    void tab.setControlValue("llmBaseUrl", "  https://example.com/v1  ");
    void tab.setControlValue("llmModel", "  test-model  ");
    void tab.setControlValue("userInterest", "  biology  ");
    await new Promise<void>((resolve) => settingsWindow.setTimeout(resolve, 300));

    expect(plugin.settings.llmBaseUrl).toBe("https://example.com/v1");
    expect(plugin.settings.llmModel).toBe("test-model");
    expect(plugin.settings.userInterest).toBe("biology");
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("reflects database readiness in declarative visibility predicates", () => {
    const isDatabaseReady = vi.fn(() => false);
    const plugin = createPluginStub({ isDatabaseReady });
    const tab = new RssReaderSettingTab({} as App, plugin);
    const databaseGroup = tab
      .getSettingDefinitions()
      .find(
        (item): item is SettingDefinitionGroup =>
          "type" in item && item.type === "group",
      );
    const currentDatabase = databaseGroup?.items?.[1];

    expect(currentDatabase && "visible" in currentDatabase).toBe(true);
    if (!currentDatabase || !("visible" in currentDatabase)) {
      return;
    }
    expect(
      typeof currentDatabase.visible === "function"
        ? currentDatabase.visible()
        : currentDatabase.visible,
    ).toBe(false);

    isDatabaseReady.mockReturnValue(true);
    expect(
      typeof currentDatabase.visible === "function"
        ? currentDatabase.visible()
        : currentDatabase.visible,
    ).toBe(true);
  });

  it("saves non-reader settings without refreshing the reader", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const plugin = createPluginStub({ saveSettings });
    const settingsWindow = new HappyWindow();
    const app = {
      workspace: { containerEl: settingsWindow.document.body },
    } as unknown as App;
    const tab = new RssReaderSettingTab(app, plugin);

    void tab.setControlValue("llmModel", "test-model");
    await new Promise<void>((resolve) => settingsWindow.setTimeout(resolve, 300));

    expect(saveSettings).toHaveBeenCalledWith(false);
  });

  it("marks a target-language change for reader refresh", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const plugin = createPluginStub({ saveSettings });
    const settingsWindow = new HappyWindow();
    const app = {
      workspace: { containerEl: settingsWindow.document.body },
    } as unknown as App;
    const tab = new RssReaderSettingTab(app, plugin);

    void tab.setControlValue("targetLanguage", "en");
    await new Promise<void>((resolve) => settingsWindow.setTimeout(resolve, 300));

    expect(saveSettings).toHaveBeenCalledWith(true);
  });

  it("marks paper-card changes for reader refresh", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const plugin = createPluginStub({ saveSettings });
    const settingsWindow = new HappyWindow();
    const app = {
      workspace: { containerEl: settingsWindow.document.body },
    } as unknown as App;
    const tab = new RssReaderSettingTab(app, plugin);

    void tab.setControlValue("cardShowAuthors", true);
    void tab.setControlValue("cardShowAbstract", true);
    await new Promise<void>((resolve) => settingsWindow.setTimeout(resolve, 300));

    expect(plugin.settings.cardShowAuthors).toBe(true);
    expect(plugin.settings.cardShowAbstract).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith(true);
  });
});

function isSettingGroup(
  item: ReturnType<RssReaderSettingTab["getSettingDefinitions"]>[number],
): item is SettingDefinitionGroup {
  return "type" in item && item.type === "group";
}

function isSettingControl(
  item: SettingGroupItem,
): item is SettingDefinitionControl {
  return "control" in item;
}

function createPluginStub(overrides: {
  isDatabaseReady?: ReturnType<typeof vi.fn>;
  saveSettings?: ReturnType<typeof vi.fn>;
} = {}): RssReaderPlugin & {
  isDatabaseReady: ReturnType<typeof vi.fn>;
  saveSettings: ReturnType<typeof vi.fn>;
} {
  const isDatabaseReady = overrides.isDatabaseReady ?? vi.fn(() => false);
  const saveSettings =
    overrides.saveSettings ?? vi.fn(async () => undefined);
  return {
    settings: { ...DEFAULT_SETTINGS },
    databaseError: null,
    databaseState: "unconfigured",
    getCurrentDatabasePath: vi.fn(() => null),
    getVaultAdapter: vi.fn(),
    isDatabaseReady,
    saveSettings,
  } as unknown as RssReaderPlugin & {
    isDatabaseReady: ReturnType<typeof vi.fn>;
    saveSettings: ReturnType<typeof vi.fn>;
  };
}
