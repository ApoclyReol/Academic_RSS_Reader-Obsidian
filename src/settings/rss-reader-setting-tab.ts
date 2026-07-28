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
      text: "运行数据库固定保存在当前 Vault 的插件目录中。请选择 Vault 内的备份目录，建议使用 Assets/RSS Reader；插件不会访问 Vault 外的路径。",
    });
    let backupDirectory = this.plugin.settings.backupDirectory;
    const databaseSetting = new Setting(containerEl)
      .setName("数据库备份目录")
      .setDesc(
        "填写相对于 Vault 根目录的路径。导出会创建带时间戳的备份；恢复会使用该目录中最近修改的 SQLite 文件。",
      )
      .addText((text) => {
        text
          .setPlaceholder("Assets/RSS Reader")
          .setValue(backupDirectory)
          .onChange((value) => {
            backupDirectory = value;
          });
        this.directorySuggest = new DirectorySuggest(
          this.app,
          text.inputEl,
          this.plugin.getVaultRoot(),
          (value) => {
            backupDirectory = value;
          },
        );
      })
      .addButton((button) =>
        button
          .setButtonText("导出备份")
          .setCta()
          .onClick(async () => {
            try {
              const destination =
                await this.plugin.exportDatabaseBackup(backupDirectory);
              new Notice(
                `数据库备份已导出到 ${destination}`,
                10_000,
              );
            } catch (error) {
              new Notice(
                error instanceof Error ? error.message : String(error),
                10_000,
              );
            }
          }),
      )
      .addButton((button) =>
        button.setButtonText("从目录恢复").onClick(async () => {
          try {
            const source =
              await this.plugin.restoreLatestDatabaseBackup(backupDirectory);
            new Notice(
              `已从 ${source} 恢复数据库；恢复前的数据库已自动备份。`,
              10_000,
            );
          } catch (error) {
            new Notice(
              error instanceof Error ? error.message : String(error),
              10_000,
            );
          }
          }),
      );
    databaseSetting.descEl.createEl("br");
    databaseSetting.descEl.createSpan({
      text: "输入目录名称时只联想当前 Vault 内已有文件夹；也可以输入尚未创建的 Assets 子目录。",
    });
    new Setting(containerEl)
      .setName("当前正在使用")
      .setDesc(this.plugin.database.path);
    if (this.plugin.databaseStartupError) {
      containerEl.createEl("p", {
        cls: "rss-reader__warning",
        text: `配置数据库无法打开，插件当前使用恢复数据库。原文件未修改。错误：${this.plugin.databaseStartupError}`,
      });
    }

    new Setting(containerEl).setName("订阅更新").setHeading();
    new Setting(containerEl)
      .setName("启动时自动更新")
      .setDesc("每次启动 Obsidian 后更新一次全部启用订阅。")
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
          try {
            new Notice(await this.plugin.llmService.testConnection());
          } catch (error) {
            new Notice(
              error instanceof Error ? error.message : String(error),
            );
          }
        }),
      );

    new Setting(containerEl).setName("旧数据迁移").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "选择旧版 rss_reader.sqlite3。插件会先只读预览，导入前备份源文件和当前插件数据库；不会修改旧文件，也不会导入 API Key 或为历史条目创建翻译任务。",
    });
    this.renderLegacyImport(containerEl);
  }

  private renderLegacyImport(container: HTMLElement): void {
    const box = container.createDiv({ cls: "rss-reader-migration" });
    const fileInput = box.createEl("input", {
      type: "file",
      attr: { accept: ".sqlite3,.db,.sqlite" },
    });
    const preview = box.createDiv({ cls: "rss-reader-migration__preview" });
    const importButton = box.createEl("button", {
      text: "确认导入",
      cls: "mod-cta",
    });
    importButton.disabled = true;
    let selectedBytes: Uint8Array | null = null;
    let selectedName = "";

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      void (async () => {
        selectedBytes = new Uint8Array(await file.arrayBuffer());
        selectedName = file.name;
        const result =
          await this.plugin.legacyImportService.preview(selectedBytes);
        preview.empty();
        if (!result.valid) {
          preview.setText(`缺少表：${result.missingTables.join("、")}`);
          importButton.disabled = true;
          return;
        }
        preview.createEl("p", {
          text: `订阅 ${result.counts.feeds}，条目 ${result.counts.items}，关联 ${result.counts.item_feeds}，推荐分数 ${result.counts.recommendation_scores}，关键词 ${result.counts.recommendation_keywords}，模型 ${result.counts.recommendation_models}`,
        });
        importButton.disabled = false;
      })();
    });

    importButton.addEventListener("click", () => {
      if (!selectedBytes) {
        return;
      }
      importButton.disabled = true;
      void (async () => {
        try {
          const report = await this.plugin.legacyImportService.import(
            selectedBytes,
            selectedName,
          );
          preview.empty();
          preview.createEl("p", {
            text: `导入完成：订阅 ${report.imported.feeds}，条目 ${report.imported.items}，跳过已有条目 ${report.skipped.items}，冲突 ${report.conflicts.length}。`,
          });
          new Notice("旧数据导入完成");
          await this.plugin.refreshViews();
        } catch (error) {
          preview.setText(
            error instanceof Error ? error.message : String(error),
          );
          importButton.disabled = false;
        }
      })();
    });
  }
}
