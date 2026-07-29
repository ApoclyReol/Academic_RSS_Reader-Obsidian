import {
  App,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
} from "obsidian";

import type RssReaderPlugin from "../main";
import { DirectorySuggest } from "./directory-suggest";

const DATABASE_FILE_NAME = ["rss", "reader.sqlite3"].join("-");

export class RssReaderSettingTab extends PluginSettingTab {
  private directorySuggest: DirectorySuggest | null = null;
  private inspectionRequest = 0;

  constructor(app: App, private readonly plugin: RssReaderPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.directorySuggest?.close();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("academic-rss-reader-settings");

    new Setting(containerEl).setName("数据库存储").setHeading();
    const storageDescription = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    storageDescription.appendText(
      "请选择当前 vault 内的数据目录。运行数据库保存为 ",
    );
    storageDescription.createEl("code", {
      text: DATABASE_FILE_NAME,
    });
    storageDescription.appendText(
      "，所有保护性备份保存在 backups 子目录。",
    );
    let dataDirectory = this.plugin.settings.dataDirectory;
    const inspection = containerEl.createEl("p", {
      cls: "setting-item-description",
      text: this.databaseStatusText(),
      attr: {
        role: "status",
        "aria-live": "polite",
      },
    });
    const databaseSetting = new Setting(containerEl)
      .setName("Academic RSS reader 数据目录")
      .setDesc("输入相对于 vault 根目录的路径；输入本身不会创建或载入数据库。")
      .addText((text) => {
        text
          .setPlaceholder("Assets/RSS reader data")
          .setValue(dataDirectory)
          .onChange((value) => {
            dataDirectory = value;
            this.updateDirectoryInspection(
              dataDirectory,
              inspection,
            );
          });
        this.directorySuggest = new DirectorySuggest(
          this.app,
          text.inputEl,
          this.plugin.getVaultAdapter(),
          (value) => {
            dataDirectory = value;
            this.updateDirectoryInspection(value, inspection);
          },
        );
      });
    if (this.plugin.isDatabaseReady()) {
      databaseSetting
        .addButton((button) =>
          button.setButtonText("迁移当前库").onClick(() => {
            this.runButtonAction(button.buttonEl, () =>
              this.runDatabaseAction(() =>
                this.plugin.switchDataDirectory(dataDirectory, "migrate"),
              ),
            );
          }),
        )
        .addButton((button) =>
          button.setButtonText("载入目标库").onClick(() => {
            this.runButtonAction(button.buttonEl, () =>
              this.runDatabaseAction(() =>
                this.plugin.switchDataDirectory(dataDirectory, "load"),
              ),
            );
          }),
        );
    } else {
      databaseSetting
        .addButton((button) =>
          button.setButtonText("创建新数据库").onClick(() => {
            this.runButtonAction(button.buttonEl, () =>
              this.runDatabaseAction(() =>
                this.plugin.createDatabase(dataDirectory),
              ),
            );
          }),
        )
        .addButton((button) =>
          button
            .setButtonText("载入数据库")
            .setCta()
            .onClick(() => {
              this.runButtonAction(button.buttonEl, () =>
                this.runDatabaseAction(() =>
                  this.plugin.loadDatabase(dataDirectory),
                ),
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
          button.setButtonText("立即备份").onClick(() => {
            this.runButtonAction(button.buttonEl, async () => {
              const destination =
                await this.plugin.createManualBackup();
              new Notice(`数据库已备份到 ${destination}`, 10_000);
            });
          }),
        )
        .addButton((button) =>
          button.setButtonText("恢复最近备份").onClick(() => {
            this.runButtonAction(button.buttonEl, async () => {
              const source =
                await this.plugin.restoreLatestDatabaseBackup();
              new Notice(
                `已从 ${source} 恢复数据库；恢复前已自动备份。`,
                10_000,
              );
            });
          }),
        );
    }
    if (this.plugin.databaseError) {
      containerEl.createEl("p", {
        cls: "rss-reader__warning",
        text: `数据库未载入，原文件未修改。错误：${this.plugin.databaseError}`,
        attr: {
          role: "alert",
        },
      });
    }

    new Setting(containerEl).setName("订阅更新").setHeading();
    new Setting(containerEl)
      .setName("打开阅读器时自动更新")
      .setDesc("每次启动 Obsidian 后，首次打开 academic RSS reader 时在后台静默更新全部启用订阅。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoUpdateOnStartup)
          .onChange((value) => {
            this.plugin.settings.autoUpdateOnStartup = value;
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName("隐藏过期天数")
      .setDesc("隐藏条目超过此天数后，在下一次订阅更新时转为已过期。")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.hiddenExpireDays))
          .onChange((value) => {
            const days = Number.parseInt(value, 10);
            if (Number.isFinite(days) && days >= 1) {
              this.plugin.settings.hiddenExpireDays = days;
              this.runAsync(() => this.plugin.saveSettings());
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
          .onChange((value) => {
            this.plugin.settings.targetLanguage = value;
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl).setName("LLM 推荐复核").setHeading();
    new Setting(containerEl)
      .setName("API 地址")
      .addText((text) =>
        text
          .setPlaceholder("HTTPS://api.OpenAI.com/v1")
          .setValue(this.plugin.settings.llmBaseUrl)
          .onChange((value) => {
            this.plugin.settings.llmBaseUrl = value.trim();
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName("API key")
      .setDesc("选择或创建 Obsidian SecretStorage 条目；data.json 只保存条目名称。")
      .addComponent((container) =>
        new SecretComponent(this.app, container)
          .setValue(this.plugin.settings.llmSecretId)
          .onChange((value) => {
            this.plugin.settings.llmSecretId = value;
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName("模型")
      .addText((text) =>
        text
          .setPlaceholder("GPT-4.1-mini")
          .setValue(this.plugin.settings.llmModel)
          .onChange((value) => {
            this.plugin.settings.llmModel = value.trim();
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName("研究兴趣补充描述")
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.userInterest)
          .onChange((value) => {
            this.plugin.settings.userInterest = value.trim();
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName("测试连接")
      .addButton((button) =>
        button.setButtonText("测试").onClick(() => {
          this.runButtonAction(button.buttonEl, async () => {
            if (!this.plugin.isDatabaseReady()) {
              throw new Error("请先配置并载入数据库");
            }
            new Notice(await this.plugin.llmService.testConnection());
          });
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
      ? "已保存数据目录；打开 Academic RSS Reader 时会尝试载入其中的数据库。"
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

  private updateDirectoryInspection(
    directory: string,
    inspection: HTMLElement,
  ): void {
    const request = ++this.inspectionRequest;
    this.runAsync(async () => {
      const message = await this.inspectDirectoryText(directory);
      if (request === this.inspectionRequest) {
        inspection.setText(message);
      }
    });
  }

  private async runDatabaseAction(
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
      new Notice("数据库操作完成");
      this.redisplay();
    } catch (error) {
      this.showError(error);
      this.redisplay();
    }
  }

  private runAsync(action: () => Promise<void>): void {
    void action().catch((error: unknown) => this.showError(error));
  }

  private runButtonAction(
    button: HTMLButtonElement,
    action: () => Promise<void>,
  ): void {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    void action()
      .catch((error: unknown) => this.showError(error))
      .finally(() => {
        button.removeAttribute("aria-busy");
        if (button.isConnected) {
          button.disabled = false;
        }
      });
  }

  private redisplay(): void {
    this.display();
  }

  private showError(error: unknown): void {
    new Notice(
      error instanceof Error ? error.message : String(error),
      10_000,
    );
  }

}
