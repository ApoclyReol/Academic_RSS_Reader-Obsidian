import {
  readdir,
  stat,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
} from "node:path";

import {
  FileSystemAdapter,
  normalizePath,
  Notice,
  Plugin,
} from "obsidian";

import { RSS_READER_VIEW_TYPE } from "./constants";
import {
  RssDatabase,
  databasePaths,
  inspectDatabaseFile,
  type DatabaseInspection,
} from "./database/database";
import {
  DEFAULT_SETTINGS,
  type RssReaderSettings,
} from "./models/settings";
import { RssRepository } from "./repositories/rss-repository";
import { RssReaderSettingTab } from "./settings/rss-reader-setting-tab";
import { FeedService } from "./services/feed-service";
import { DatabaseOperationCoordinator } from "./services/database-operation-coordinator";
import { LlmService } from "./services/llm-service";
import { RecommendationService } from "./services/recommendation-service";
import { GoogleWebTranslationProvider } from "./services/translation-provider";
import { TranslationService } from "./services/translation-service";
import { resolveVaultDirectoryPath } from "./services/vault-path";
import { RssReaderView } from "./views/rss-reader-view";

export type DatabaseState =
  | "unconfigured"
  | "initializing"
  | "ready"
  | "error";
export type DirectorySwitchMode = "migrate" | "load";

interface ServiceContext {
  database: RssDatabase;
  repository: RssRepository;
  feedService: FeedService;
  translationService: TranslationService;
  recommendationService: RecommendationService;
  llmService: LlmService;
  unsubscribeTranslation: () => void;
}

export default class RssReaderPlugin extends Plugin {
  settings: RssReaderSettings = DEFAULT_SETTINGS;
  databaseState: DatabaseState = "unconfigured";
  databaseError: string | null = null;
  private context: ServiceContext | null = null;
  private automaticUpdateStarted = false;
  private vaultRoot = "";
  private readonly operationCoordinator =
    new DatabaseOperationCoordinator();
  private static readonly LLM_SECRET_ID =
    "academic-rss-reader-llm-api-key";

  get database(): RssDatabase {
    return this.requireContext().database;
  }

  get repository(): RssRepository {
    return this.requireContext().repository;
  }

  get feedService(): FeedService {
    return this.requireContext().feedService;
  }

  get translationService(): TranslationService {
    return this.requireContext().translationService;
  }

  get recommendationService(): RecommendationService {
    return this.requireContext().recommendationService;
  }

  get llmService(): LlmService {
    return this.requireContext().llmService;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Academic RSS Reader 仅支持 Obsidian 桌面端文件系统");
    }
    this.vaultRoot = adapter.getBasePath();

    this.registerView(
      RSS_READER_VIEW_TYPE,
      (leaf) => new RssReaderView(leaf, this),
    );
    this.addRibbonIcon("rss", "打开 academic RSS reader", () => {
      this.runPluginAction(() => this.activateView());
    });
    this.addCommand({
      id: "open-reader",
      name: "打开阅读器",
      callback: () => this.runPluginAction(() => this.activateView()),
    });
    this.addCommand({
      id: "update-feeds",
      name: "更新全部启用订阅",
      callback: () =>
        this.runPluginAction(() =>
          this.runUpdateWithNotice("手动更新"),
        ),
    });
    this.addSettingTab(new RssReaderSettingTab(this.app, this));
    this.register(() => {
      void this.disposeContext(this.context).catch(() => undefined);
    });
  }

  async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData();
    const storedSettings = isPartialSettings(stored) ? stored : {};
    const legacyStoredSettings = storedSettings as
      Partial<RssReaderSettings> & { llmApiKey?: unknown };
    const legacyApiKey =
      typeof legacyStoredSettings.llmApiKey === "string"
        ? legacyStoredSettings.llmApiKey.trim()
        : "";
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
    };
    const legacySettings = this.settings as RssReaderSettings & {
      backupDirectory?: string;
      databaseDirectory?: string;
      llmApiKey?: string;
    };
    delete legacySettings.backupDirectory;
    delete legacySettings.databaseDirectory;
    delete legacySettings.llmApiKey;
    this.settings.dataDirectory =
      typeof this.settings.dataDirectory === "string"
        ? this.settings.dataDirectory
        : "";
    this.settings.llmSecretId =
      typeof this.settings.llmSecretId === "string"
        ? this.settings.llmSecretId
        : "";
    if (legacyApiKey) {
      const secretId = this.findAvailableLegacySecretId(legacyApiKey);
      this.app.secretStorage.setSecret(secretId, legacyApiKey);
      this.settings.llmSecretId = secretId;
      await this.saveData(this.settings);
      new Notice(
        "Academic RSS Reader 已将旧 LLM API Key 迁移到 Obsidian SecretStorage，并从 data.json 删除明文。",
        10_000,
      );
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refreshViews();
  }

  isDatabaseReady(): boolean {
    return this.databaseState === "ready" && this.context !== null;
  }

  getVaultRoot(): string {
    return this.vaultRoot;
  }

  getCurrentDatabasePath(): string | null {
    return this.context?.database.path ?? null;
  }

  getCurrentBackupDirectory(): string | null {
    if (!this.isDatabaseReady()) {
      return null;
    }
    return databasePaths(
      dirname(this.requireContext().database.path),
    ).backupDirectory;
  }

  async inspectDataDirectory(
    directory: string,
  ): Promise<DatabaseInspection> {
    const paths = databasePaths(
      await this.resolveVaultDirectory(directory),
    );
    return inspectDatabaseFile(paths.databasePath);
  }

  prepareDatabaseOnViewOpen(): void {
    if (this.isDatabaseReady()) {
      this.startAutomaticUpdateOnViewOpen();
      return;
    }
    if (
      this.databaseState !== "initializing" &&
      this.settings.dataDirectory
    ) {
      this.databaseState = "initializing";
      this.databaseError = null;
      void this.initializeConfiguredDatabase(
        this.settings.dataDirectory,
      );
    }
  }

  async createDatabase(directory: string): Promise<void> {
    if (this.isDatabaseReady()) {
      throw new Error("数据库已在运行；请使用“切换数据目录”");
    }
    const normalized = normalizeDirectory(directory);
    const paths = databasePaths(
      await this.resolveVaultDirectory(normalized),
    );
    const inspection = await inspectDatabaseFile(paths.databasePath);
    if (inspection.exists) {
      throw new Error("所选目录已存在 rss-reader.sqlite3，请使用载入");
    }
    await this.activateInitialDatabase(normalized, true);
  }

  async loadDatabase(directory: string): Promise<void> {
    const normalized = normalizeDirectory(directory);
    if (this.isDatabaseReady()) {
      if (normalized === this.settings.dataDirectory) {
        return;
      }
      throw new Error("数据库已在运行；请使用“切换数据目录”");
    }
    const inspection = await this.inspectDataDirectory(normalized);
    if (!inspection.exists || !inspection.valid) {
      throw new Error(
        inspection.error ?? "所选目录中没有 rss-reader.sqlite3",
      );
    }
    await this.activateInitialDatabase(normalized, false);
  }

  async switchDataDirectory(
    directory: string,
    mode: DirectorySwitchMode,
  ): Promise<void> {
    const current = this.requireContext();
    const releaseTransition =
      this.operationCoordinator.acquireTransition();
    let next: ServiceContext | null = null;
    try {
      const normalized = normalizeDirectory(directory);
      if (normalized === this.settings.dataDirectory) {
        throw new Error("所选目录就是当前数据目录");
      }
      const targetPaths = databasePaths(
        await this.resolveVaultDirectory(normalized),
      );
      if (targetPaths.databasePath === current.database.path) {
        throw new Error("所选目录指向当前数据目录");
      }
      const targetInspection = await inspectDatabaseFile(
        targetPaths.databasePath,
      );

      if (mode === "migrate") {
        if (targetInspection.exists) {
          throw new Error("目标目录已存在 rss-reader.sqlite3，迁移不会覆盖它");
        }
      } else if (!targetInspection.exists || !targetInspection.valid) {
        throw new Error(
          targetInspection.error ?? "目标目录中没有可载入的 rss-reader.sqlite3",
        );
      }

      await this.createProtectionBackup("before-switch");
      if (mode === "migrate") {
        await current.database.backup(targetPaths.databasePath);
        const copied = await inspectDatabaseFile(targetPaths.databasePath);
        if (!copied.valid) {
          throw new Error(copied.error ?? "迁移后的数据库校验失败");
        }
      }

      next = await this.buildContext(targetPaths.databasePath, false);
      await this.saveData({ ...this.settings, dataDirectory: normalized });
      const previous = this.context;
      this.context = next;
      next = null;
      this.settings.dataDirectory = normalized;
      this.databaseState = "ready";
      this.databaseError = null;
      this.automaticUpdateStarted = false;
      await this.disposeContext(previous);
    } finally {
      if (next) {
        await this.disposeContext(next);
      }
      releaseTransition();
      this.context?.translationService.resume();
    }
    await this.refreshViews();
  }

  async createManualBackup(): Promise<string> {
    return this.createProtectionBackup("manual");
  }

  async restoreLatestDatabaseBackup(): Promise<string> {
    const context = this.requireContext();
    const releaseTransition =
      this.operationCoordinator.acquireTransition();
    let restoredSource!: string;
    try {
      const backupDirectory = this.getCurrentBackupDirectory();
      if (!backupDirectory) {
        throw new Error("请先配置并载入数据库");
      }
      const entries = await readdir(backupDirectory, {
        withFileTypes: true,
      }).catch(() => []);
      const candidates = await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() &&
              /^(before-|manual-).*\.(sqlite3|sqlite|db)$/i.test(entry.name),
          )
          .map(async (entry) => {
            const path = join(backupDirectory, entry.name);
            return { path, modifiedAt: (await stat(path)).mtimeMs };
          }),
      );
      const ordered = candidates.sort(
        (left, right) => right.modifiedAt - left.modifiedAt,
      );
      let source: string | null = null;
      for (const candidate of ordered) {
        if ((await inspectDatabaseFile(candidate.path)).valid) {
          source = candidate.path;
          break;
        }
      }
      if (!source) {
        throw new Error("当前数据目录的 backups 中没有有效数据库备份");
      }
      await this.createProtectionBackup("before-restore");
      await context.database.restoreFromFile(source);
      await context.translationService.initialize();
      this.databaseError = null;
      restoredSource = source;
    } finally {
      releaseTransition();
      context.translationService.resume();
    }
    await this.refreshViews();
    return restoredSource;
  }

  openSettings(): void {
    const setting = (
      this.app as typeof this.app & {
        setting: {
          open(): void;
          openTabById(id: string): void;
        };
      }
    ).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
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

  async runAutomaticUpdateOnViewOpen(): Promise<void> {
    if (
      !this.isDatabaseReady() ||
      !this.settings.autoUpdateOnStartup ||
      this.automaticUpdateStarted
    ) {
      return;
    }
    this.automaticUpdateStarted = true;
    if (this.feedService.isUpdating()) {
      return;
    }
    await this.runUpdateWithNotice("启动时自动更新");
  }

  private async initializeConfiguredDatabase(
    directory: string,
  ): Promise<void> {
    try {
      await this.loadDatabase(directory);
      this.startAutomaticUpdateOnViewOpen();
    } catch (error) {
      this.databaseState = "error";
      this.databaseError =
        error instanceof Error ? error.message : String(error);
      await this.refreshViews().catch(() => undefined);
    }
  }

  private startAutomaticUpdateOnViewOpen(): void {
    void this.runAutomaticUpdateOnViewOpen();
  }

  private async activateInitialDatabase(
    directory: string,
    createIfMissing: boolean,
  ): Promise<void> {
    this.databaseState = "initializing";
    this.databaseError = null;
    await this.refreshViews();
    const path = databasePaths(
      await this.resolveVaultDirectory(directory),
    ).databasePath;
    let next: ServiceContext | null = null;
    try {
      next = await this.buildContext(path, createIfMissing);
      await this.saveData({ ...this.settings, dataDirectory: directory });
      this.context = next;
      this.settings.dataDirectory = directory;
      this.databaseState = "ready";
      this.automaticUpdateStarted = false;
      await this.refreshViews();
    } catch (error) {
      await this.disposeContext(next);
      this.databaseState = "error";
      this.databaseError =
        error instanceof Error ? error.message : String(error);
      await this.refreshViews();
      throw error;
    }
  }

  private async buildContext(
    databasePath: string,
    createIfMissing: boolean,
  ): Promise<ServiceContext> {
    const timerWindow =
      this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!timerWindow) {
      throw new Error("无法获取 Obsidian 工作区窗口");
    }
    const database = new RssDatabase(databasePath);
    try {
      await database.initialize({ createIfMissing });
      const repository = new RssRepository(database);
      const identityRepair = await repository.repairLegacyItemIdentity();
      if (identityRepair.removedItems > 0) {
        new Notice(
          `已修复 ${identityRepair.removedItems} 条重复文献，并保留原有状态与关联。`,
          8_000,
        );
      }
      database.setOperationCoordinator(this.operationCoordinator);
      const translationService = new TranslationService(
        repository,
        new GoogleWebTranslationProvider(),
        () => this.settings,
        timerWindow,
        this.operationCoordinator,
        (error) => {
          new Notice(
            `翻译任务失败：${error instanceof Error ? error.message : String(error)}`,
            10_000,
          );
        },
      );
      const feedService = new FeedService(
        repository,
        () => this.settings,
        {
          onSettingsChanged: async () => this.refreshViews(),
        },
        timerWindow,
        this.operationCoordinator,
      );
      const context: ServiceContext = {
        database,
        repository,
        feedService,
        translationService,
        recommendationService: new RecommendationService(
          repository,
          this.operationCoordinator,
          () =>
            new Promise<void>((resolve) => {
              timerWindow.setTimeout(resolve, 0);
            }),
        ),
        llmService: new LlmService(
          repository,
          () => this.settings,
          () => this.getLlmApiKey(),
          this.operationCoordinator,
        ),
        unsubscribeTranslation: () => undefined,
      };
      context.unsubscribeTranslation = translationService.onChange(() => {
        for (const leaf of this.app.workspace.getLeavesOfType(
          RSS_READER_VIEW_TYPE,
        )) {
          if (leaf.view instanceof RssReaderView) {
            leaf.view.refreshTranslatedTitles();
          }
        }
      });
      await translationService.initialize();
      return context;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private async createProtectionBackup(prefix: string): Promise<string> {
    const context = this.requireContext();
    const backupDirectory = this.getCurrentBackupDirectory();
    if (!backupDirectory) {
      throw new Error("请先配置并载入数据库");
    }
    const destination = join(
      backupDirectory,
      `${prefix}-${fileTimestamp()}.sqlite3`,
    );
    await context.database.backup(destination);
    return destination;
  }

  private async disposeContext(
    context: ServiceContext | null,
  ): Promise<void> {
    if (!context) {
      return;
    }
    context.unsubscribeTranslation();
    await context.translationService.stop();
    context.database.close();
    if (this.context === context) {
      this.context = null;
    }
  }

  private requireContext(): ServiceContext {
    if (!this.context || this.databaseState !== "ready") {
      throw new Error("请先在 Academic RSS Reader 设置中选择并载入数据目录");
    }
    return this.context;
  }

  private async runUpdateWithNotice(trigger: string): Promise<void> {
    if (!this.isDatabaseReady()) {
      new Notice("请先在 academic RSS reader 设置中选择并载入数据目录");
      return;
    }
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
      this.app.workspace.containerEl.ownerDocument.defaultView?.setTimeout(
        () => notice.hide(),
        5000,
      );
    }
  }

  private runPluginAction(action: () => Promise<void>): void {
    void action().catch((error: unknown) => {
      new Notice(
        error instanceof Error ? error.message : String(error),
        10_000,
      );
    });
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

  private async resolveVaultDirectory(
    directory: string,
  ): Promise<string> {
    if (isAbsolute(directory.trim())) {
      throw new Error("请选择当前 Vault 内的相对目录");
    }
    const value = normalizeDirectory(directory);
    return resolveVaultDirectoryPath(this.vaultRoot, value);
  }

  getLlmApiKey(): string {
    return this.settings.llmSecretId
      ? (this.app.secretStorage.getSecret(this.settings.llmSecretId) ?? "")
      : "";
  }

  private findAvailableLegacySecretId(legacyApiKey: string): string {
    const base = RssReaderPlugin.LLM_SECRET_ID;
    const existing = this.app.secretStorage.getSecret(base);
    if (!existing || existing === legacyApiKey) {
      return base;
    }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      const candidateValue =
        this.app.secretStorage.getSecret(candidate);
      if (!candidateValue || candidateValue === legacyApiKey) {
        return candidate;
      }
    }
  }
}

function isPartialSettings(
  value: unknown,
): value is Partial<RssReaderSettings> {
  return typeof value === "object" && value !== null;
}

function normalizeDirectory(directory: string): string {
  const trimmed = directory.trim();
  return trimmed
    ? normalizePath(trimmed).replace(/^\/+|\/+$/g, "")
    : "";
}

function fileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
