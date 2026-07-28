import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import type RssReaderPlugin from "../main";
import { DirectorySuggest } from "./directory-suggest";

export class RssReaderSettingTab extends PluginSettingTab {
  private directorySuggest: DirectorySuggest | null = null;

  constructor(app: App, private readonly plugin: RssReaderPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.directorySuggest?.close();
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("数据库存储").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "请选择当前 Vault 内的数据目录。运行数据库保存为 rss-reader.sqlite3，所有保护性备份保存在 backups 子目录。",
    });
    let dataDirectory = this.plugin.settings.dataDirectory;
    const inspection = containerEl.createEl("p", {
      cls: "setting-item-description",
      text: this.databaseStatusText(),
    });
    const databaseSetting = new Setting(containerEl)
      .setName("RSS Reader 数据目录")
      .setDesc("输入相对于 Vault 根目录的路径；输入本身不会创建或载入数据库。")
      .addText((text) => {
        text
          .setPlaceholder("Assets/RSS Reader Data")
          .setValue(dataDirectory)
          .onChange(async (value) => {
            dataDirectory = value;
            inspection.setText(
              await this.inspectDirectoryText(dataDirectory),
            );
          });
        this.directorySuggest = new DirectorySuggest(
          this.app,
          text.inputEl,
          this.plugin.getVaultRoot(),
          (value) => {
            dataDirectory = value;
            void this.inspectDirectoryText(value).then((message) =>
              inspection.setText(message),
            );
          },
        );
      });
    if (this.plugin.isDatabaseReady()) {
      databaseSetting
        .addButton((button) =>
          button.setButtonText("迁移当前库").onClick(async () => {
            await this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(dataDirectory, "migrate"),
            );
          }),
        )
        .addButton((button) =>
          button.setButtonText("载入目标库").onClick(async () => {
            await this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(dataDirectory, "load"),
            );
          }),
        );
    } else {
      databaseSetting
        .addButton((button) =>
          button.setButtonText("创建新数据库").onClick(async () => {
            await this.runDatabaseAction(() =>
              this.plugin.createDatabase(dataDirectory),
            );
          }),
        )
        .addButton((button) =>
          button
            .setButtonText("载入数据库")
            .setCta()
            .onClick(async () => {
              await this.runDatabaseAction(() =>
                this.plugin.loadDatabase(dataDirectory),
              );
            }),
        );
    }
    databaseSetting.descEl.createEl("br");
    databaseSetting.descEl.createSpan({
      text: "已有有效数据库时使用载入；没有数据库时使用创建。切换和迁移不会覆盖目标文件。",
    });
    if (this.plugin.isDatabaseReady()) {
      new Setting(containerEl)
        .setName("当前正在使用")
        .setDesc(this.plugin.getCurrentDatabasePath() ?? "");
      new Setting(containerEl)
        .setName("数据库保护")
        .setDesc("备份文件保存在当前数据目录的 backups 子目录。")
        .addButton((button) =>
          button.setButtonText("立即备份").onClick(async () => {
            try {
              const destination =
                await this.plugin.createManualBackup();
              new Notice(`数据库已备份到 ${destination}`, 10_000);
            } catch (error) {
              this.showError(error);
            }
          }),
        )
        .addButton((button) =>
          button.setButtonText("恢复最近备份").onClick(async () => {
            try {
              const source =
                await this.plugin.restoreLatestDatabaseBackup();
              new Notice(
                `已从 ${source} 恢复数据库；恢复前已自动备份。`,
                10_000,
              );
            } catch (error) {
              this.showError(error);
            }
          }),
        );
    }
    if (this.plugin.databaseError) {
      containerEl.createEl("p", {
        cls: "rss-reader__warning",
        text: `数据库未载入，原文件未修改。错误：${this.plugin.databaseError}`,
      });
    }

    new Setting(containerEl).setName("订阅更新").setHeading();
    new Setting(containerEl)
      .setName("打开阅读器时自动更新")
      .setDesc("每次启动 Obsidian 后，首次打开 RSS Reader 时在后台静默更新全部启用订阅。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoUpdateOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.autoUpdateOnStartup = value;
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("隐藏过期天数")
      .setDesc("隐藏条目超过此天数后，在下一次订阅更新时转为已过期。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.hiddenExpireDays))
          .onChange(async (value) => {
            const days = Number.parseInt(value, 10);
            if (Number.isFinite(days) && days >= 1) {
              this.plugin.settings.hiddenExpireDays = days;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl).setName("实验性网页翻译").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "使用 Google 非正式免密网页接口。接口可能限流或失效，译文不保证专业术语准确，不应用于正式引用。文本由本机直接发送，不经过开发者服务器。",
    });
    new Setting(containerEl)
      .setName("目标语言")
      .setDesc("默认并推荐简体中文。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("zh-CN", "简体中文")
          .addOption("en", "English")
          .setValue(this.plugin.settings.targetLanguage)
          .onChange(async (value) => {
            this.plugin.settings.targetLanguage = value;
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl).setName("LLM 推荐复核").setHeading();
    new Setting(containerEl)
      .setName("API 地址")
      .addText((text) =>
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.plugin.settings.llmBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.llmBaseUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("API Key")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setValue(this.plugin.settings.llmApiKey)
          .onChange(async (value) => {
            this.plugin.settings.llmApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("模型")
      .addText((text) =>
        text
          .setPlaceholder("gpt-4.1-mini")
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value) => {
            this.plugin.settings.llmModel = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("研究兴趣补充描述")
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.userInterest)
          .onChange(async (value) => {
            this.plugin.settings.userInterest = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("测试连接")
      .addButton((button) =>
        button.setButtonText("测试").onClick(async () => {
          if (!this.plugin.isDatabaseReady()) {
            new Notice("请先配置并载入数据库");
            return;
          }
          try {
            new Notice(await this.plugin.llmService.testConnection());
          } catch (error) {
            new Notice(
              error instanceof Error ? error.message : String(error),
            );
          }
        }),
      );

  }

  private databaseStatusText(): string {
    if (this.plugin.databaseState === "ready") {
      return "数据库已就绪。输入其他目录后可迁移当前库或载入目标库。";
    }
    if (this.plugin.databaseState === "initializing") {
      return "正在初始化数据库……";
    }
    if (this.plugin.databaseState === "error") {
      return `数据库载入失败：${this.plugin.databaseError ?? "未知错误"}`;
    }
    return this.plugin.settings.dataDirectory
      ? "已保存数据目录；打开 RSS Reader 时会尝试载入其中的数据库。"
      : "尚未配置数据目录。";
  }

  private async inspectDirectoryText(directory: string): Promise<string> {
    if (!directory.trim()) {
      return "请输入当前 Vault 内的数据目录。";
    }
    try {
      const result = await this.plugin.inspectDataDirectory(directory);
      if (!result.exists) {
        return "目录中没有数据库，可以创建新数据库。";
      }
      if (result.valid) {
        return "发现有效的 rss-reader.sqlite3，可以载入。";
      }
      return `发现数据库文件，但校验失败：${result.error ?? "未知错误"}`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async runDatabaseAction(
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
      new Notice("数据库操作完成");
      this.display();
    } catch (error) {
      this.showError(error);
      this.display();
    }
  }

  private showError(error: unknown): void {
    new Notice(
      error instanceof Error ? error.message : String(error),
      10_000,
    );
  }

}
