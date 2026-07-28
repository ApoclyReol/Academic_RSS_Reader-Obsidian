import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { FileSystemAdapter, Notice, Plugin } from "obsidian";

import { RSS_READER_VIEW_TYPE } from "./constants";
import {
  RssDatabase,
  databasePaths,
  recoveryDatabasePath,
} from "./database/database";
import {
  DEFAULT_SETTINGS,
  type RssReaderSettings,
} from "./models/settings";
import { RssRepository } from "./repositories/rss-repository";
import { RssReaderSettingTab } from "./settings/rss-reader-setting-tab";
import { FeedService } from "./services/feed-service";
import { LegacyImportService } from "./services/legacy-import-service";
import { LlmService } from "./services/llm-service";
import { RecommendationService } from "./services/recommendation-service";
import { GoogleWebTranslationProvider } from "./services/translation-provider";
import { TranslationService } from "./services/translation-service";
import { RssReaderView } from "./views/rss-reader-view";

export default class RssReaderPlugin extends Plugin {
  settings: RssReaderSettings = DEFAULT_SETTINGS;
  database!: RssDatabase;
  repository!: RssRepository;
  feedService!: FeedService;
  translationService!: TranslationService;
  recommendationService!: RecommendationService;
  llmService!: LlmService;
  legacyImportService!: LegacyImportService;
  databaseStartupError: string | null = null;
  private pluginDirectory = "";
  private vaultRoot = "";
  private primaryDatabasePath = "";

  async onload(): Promise<void> {
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("RSS Reader 仅支持 Obsidian 桌面端文件系统");
    }
    const pluginDirectory = adapter.getFullPath(
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
    );
    this.pluginDirectory = pluginDirectory;
    this.vaultRoot = adapter.getBasePath();
    const paths = databasePaths(pluginDirectory);
    this.primaryDatabasePath = paths.databasePath;
    this.database = new RssDatabase(paths.databasePath);
    try {
      await this.database.initialize();
    } catch (error) {
      this.databaseStartupError =
        error instanceof Error ? error.message : String(error);
      this.database = new RssDatabase(
        recoveryDatabasePath(pluginDirectory),
      );
      await this.database.initialize();
      new Notice(
        `数据库无法打开，RSS Reader 已进入恢复模式。原文件未修改：${this.databaseStartupError}`,
        0,
      );
    }
    this.repository = new RssRepository(this.database);
    const identityRepair =
      await this.repository.repairLegacyItemIdentity();
    if (identityRepair.removedItems > 0) {
      new Notice(
        `已修复 ${identityRepair.removedItems} 条重复文献，并保留原有状态与关联。`,
        8_000,
      );
    }

    this.translationService = new TranslationService(
      this.repository,
      new GoogleWebTranslationProvider(),
      () => this.settings,
    );
    this.feedService = new FeedService(
      this.repository,
      () => this.settings,
      {
        onNewItems: (itemIds) =>
          this.translationService.enqueueNewItems(itemIds),
        onSettingsChanged: async () => this.refreshViews(),
      },
    );
    this.recommendationService = new RecommendationService(this.repository);
    this.llmService = new LlmService(this.repository, () => this.settings);
    this.legacyImportService = new LegacyImportService(
      this.database,
      this.databaseStartupError
        ? databasePaths(pluginDirectory).backupDirectory
        : paths.backupDirectory,
    );
    await this.translationService.initialize();
    this.register(() => this.translationService.stop());
    this.register(
      this.translationService.onChange(() => {
        for (const leaf of this.app.workspace.getLeavesOfType(
          RSS_READER_VIEW_TYPE,
        )) {
          if (leaf.view instanceof RssReaderView) {
            leaf.view.refreshTranslatedTitles();
          }
        }
      }),
    );

    this.registerView(
      RSS_READER_VIEW_TYPE,
      (leaf) => new RssReaderView(leaf, this),
    );
    this.addRibbonIcon("rss", "打开 RSS reader", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-reader",
      name: "打开阅读器",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "update-feeds",
      name: "更新全部启用订阅",
      callback: () => void this.runStartupUpdate("手动更新"),
    });
    this.addSettingTab(new RssReaderSettingTab(this.app, this));

    if (this.settings.autoUpdateOnStartup) {
      window.setTimeout(() => void this.runStartupUpdate("启动自动更新"), 500);
    }
  }

  onunload(): void {
    this.translationService?.stop();
    this.database?.close();
  }

  async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(isPartialSettings(stored) ? stored : {}),
    };
    delete (
      this.settings as RssReaderSettings & {
        databaseDirectory?: string;
      }
    ).databaseDirectory;
    this.settings.autoTranslateTitles = false;
    this.settings.abstractTranslationMode = "manual";
    this.settings.pauseAutomaticTranslation = true;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refreshViews();
  }

  async exportDatabaseBackup(directory: string): Promise<string> {
    const destinationDirectory = this.resolveVaultDirectory(directory);
    const destination = join(
      destinationDirectory,
      `rss-reader-backup-${fileTimestamp()}.sqlite3`,
    );
    await this.database.backup(destination);
    this.settings.backupDirectory = directory.trim();
    await this.saveSettings();
    return destination;
  }

  async restoreLatestDatabaseBackup(directory: string): Promise<string> {
    const sourceDirectory = this.resolveVaultDirectory(directory);
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() && /\.(sqlite3|sqlite|db)$/i.test(entry.name),
        )
        .map(async (entry) => {
          const path = join(sourceDirectory, entry.name);
          return { path, modifiedAt: (await stat(path)).mtimeMs };
        }),
    );
    const source = candidates.sort(
      (left, right) => right.modifiedAt - left.modifiedAt,
    )[0];
    if (!source) {
      throw new Error("所选目录中没有 SQLite 备份文件");
    }
    await this.database.backup(
      join(
        this.pluginDirectory,
        "backups",
        `before-restore-${fileTimestamp()}.sqlite3`,
      ),
    );
    await this.database.restoreFromFile(source.path);
    if (this.database.path !== this.primaryDatabasePath) {
      await this.database.backup(this.primaryDatabasePath);
    }
    this.settings.backupDirectory = directory.trim();
    await this.saveSettings();
    this.databaseStartupError = null;
    await this.refreshViews();
    return source.path;
  }

  getVaultRoot(): string {
    return this.vaultRoot;
  }

  async refreshViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(
      RSS_READER_VIEW_TYPE,
    )) {
      if (leaf.view instanceof RssReaderView) {
        await leaf.view.refresh();
      }
    }
  }

  private async runStartupUpdate(trigger: string): Promise<void> {
    if (this.feedService.isUpdating()) {
      return;
    }
    const notice = new Notice(`${trigger}正在进行……`, 0);
    try {
      const results = await this.feedService.updateFeeds();
      const newItems = results.reduce(
        (sum, result) => sum + result.newItems,
        0,
      );
      const failed = results.filter((result) => result.error).length;
      notice.setMessage(
        `${trigger}完成：新增 ${newItems} 条，失败订阅 ${failed} 个`,
      );
    } catch (error) {
      notice.setMessage(
        `${trigger}失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      window.setTimeout(() => notice.hide(), 5000);
    }
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

  private resolveVaultDirectory(directory: string): string {
    const value = directory.trim().replace(/^\/+|\/+$/g, "");
    if (!value || isAbsolute(directory.trim())) {
      throw new Error("请选择当前 Vault 内的相对目录");
    }
    const destination = resolve(this.vaultRoot, value);
    const pathFromVault = relative(this.vaultRoot, destination);
    if (
      pathFromVault.startsWith("..") ||
      isAbsolute(pathFromVault)
    ) {
      throw new Error("备份目录必须位于当前 Vault 内");
    }
    return destination;
  }
}

function isPartialSettings(
  value: unknown,
): value is Partial<RssReaderSettings> {
  return typeof value === "object" && value !== null;
}

function fileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
