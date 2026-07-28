import { Plugin } from "obsidian";

import { RSS_READER_VIEW_TYPE } from "./constants";
import {
  DEFAULT_SETTINGS,
  type RssReaderSettings,
} from "./models/settings";
import { RssReaderSettingTab } from "./settings/rss-reader-setting-tab";
import { RssReaderView } from "./views/rss-reader-view";

export default class RssReaderPlugin extends Plugin {
  settings: RssReaderSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      RSS_READER_VIEW_TYPE,
      (leaf) => new RssReaderView(leaf),
    );

    this.addRibbonIcon("rss", "打开 RSS reader", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-reader",
      name: "打开阅读器",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new RssReaderSettingTab(this.app, this));
  }

  onunload(): void {
    // Registered resources are disposed by Obsidian.
  }

  async loadSettings(): Promise<void> {
    const storedSettings: unknown = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(this.isSettings(storedSettings) ? storedSettings : {}),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(RSS_READER_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({
        type: RSS_READER_VIEW_TYPE,
        active: true,
      });
    }

    await workspace.revealLeaf(leaf);
  }

  private isSettings(value: unknown): value is Partial<RssReaderSettings> {
    return typeof value === "object" && value !== null;
  }
}
