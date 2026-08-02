import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("obsidian", () => {
  class MockPluginSettingTab {
    constructor(_app: unknown, _plugin: unknown) {}

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
import { DEFAULT_SETTINGS } from "../src/models/settings";
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
      "实验性网页翻译",
      "LLM 推荐复核",
    ]);
    expect(controls.map((item) => item.control.key)).toEqual([
      "autoUpdateOnStartup",
      "hiddenExpireDays",
      "targetLanguage",
      "llmBaseUrl",
      "llmModel",
      "userInterest",
    ]);
    expect(items.filter((item) => "render" in item)).toHaveLength(6);
  });

  it("keeps normalized values when declarative controls save", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const plugin = createPluginStub({ saveSettings });
    const tab = new RssReaderSettingTab({} as App, plugin);

    await tab.setControlValue("llmBaseUrl", "  https://example.com/v1  ");
    await tab.setControlValue("llmModel", "  test-model  ");
    await tab.setControlValue("userInterest", "  biology  ");

    expect(plugin.settings.llmBaseUrl).toBe("https://example.com/v1");
    expect(plugin.settings.llmModel).toBe("test-model");
    expect(plugin.settings.userInterest).toBe("biology");
    expect(saveSettings).toHaveBeenCalledTimes(3);
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
