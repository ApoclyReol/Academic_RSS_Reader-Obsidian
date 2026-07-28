import { App, PluginSettingTab, Setting } from "obsidian";

import type RssReaderPlugin from "../main";

export class RssReaderSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: RssReaderPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("常规").setHeading();

    new Setting(containerEl)
      .setName("自动刷新间隔")
      .setDesc("RSS 自动刷新间隔（分钟）。")
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.refreshIntervalMinutes))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed >= 5) {
              this.plugin.settings.refreshIntervalMinutes = parsed;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("保存条目时创建笔记")
      .setDesc("把收藏的 RSS 条目写成 vault 内的 Markdown 笔记。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createNotesForSavedItems)
          .onChange(async (value) => {
            this.plugin.settings.createNotesForSavedItems = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("收藏笔记目录")
      .setDesc("相对于 vault 根目录的路径。")
      .addText((text) =>
        text
          .setPlaceholder("RSS reader/saved")
          .setValue(this.plugin.settings.savedItemsFolder)
          .onChange(async (value) => {
            this.plugin.settings.savedItemsFolder =
              value.trim() || "RSS Reader/Saved";
            await this.plugin.saveSettings();
          }),
      );
  }
}
