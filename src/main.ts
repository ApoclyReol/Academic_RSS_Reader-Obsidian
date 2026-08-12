import {
  getLanguage,
  normalizePath,
  Notice,
  Platform,
  Plugin,
} from "obsidian";

import { RSS_READER_VIEW_TYPE } from "./constants";
import { setUiLanguage, t } from "./i18n";
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
import type { TranslationChange } from "./services/translation-service";

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
  private settingTab: RssReaderSettingTab | null = null;
  private automaticUpdateStarted = false;
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
    setUiLanguage(getLanguage());
    await this.loadSettings();
    if (!Platform.isDesktop) {
      throw new Error(t("ui.reader_is_available_on_desktop_only"));
    }

    this.registerView(
      RSS_READER_VIEW_TYPE,
      (leaf) => new RssReaderView(leaf, this),
    );
    this.addRibbonIcon("rss", t("ui.open_reader"), () => {
      this.runPluginAction(() => this.activateView());
    });
    this.addCommand({
      id: "open-reader",
      name: t("ui.open_reader_2"),
      callback: () => this.runPluginAction(() => this.activateView()),
    });
    this.addCommand({
      id: "update-feeds",
      name: t("ui.update_all_enabled_feeds"),
      callback: () =>
        this.runPluginAction(() =>
          this.runUpdateWithNotice(t("ui.manual_update")),
        ),
    });
    this.settingTab = new RssReaderSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  onunload(): void {
    this.settingTab = null;
    void this.disposeContext(this.context).catch(() => undefined);
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
        t("ui.reader_moved_the_legacy_llm_api_key_to_secretstorage_and_removed_the_pla"),
        10_000,
      );
    }
  }

  async saveSettings(refreshReader = true): Promise<void> {
    await this.saveData(this.settings);
    if (refreshReader) {
      await this.refreshViews();
    }
  }

  isDatabaseReady(): boolean {
    return this.databaseState === "ready" && this.context !== null;
  }

  getVaultAdapter(): typeof this.app.vault.adapter {
    return this.app.vault.adapter;
  }

  getCurrentDatabasePath(): string | null {
    return this.context?.database.path ?? null;
  }

  getCurrentBackupDirectory(): string | null {
    if (!this.isDatabaseReady()) {
      return null;
    }
    return databasePaths(this.settings.dataDirectory).backupDirectory;
  }

  async inspectDataDirectory(
    directory: string,
  ): Promise<DatabaseInspection> {
    const paths = databasePaths(
      await this.resolveVaultDirectory(directory),
    );
    return inspectDatabaseFile(
      this.app.vault.adapter,
      paths.databasePath,
    );
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
      this.refreshSettings();
      void this.initializeConfiguredDatabase(
        this.settings.dataDirectory,
      );
    }
  }

  async createDatabase(directory: string): Promise<void> {
    if (this.isDatabaseReady()) {
      throw new Error(t("ui.a_database_is_already_running_use_the_data_directory_switch_controls"));
    }
    const normalized = normalizeDirectory(directory);
    const paths = databasePaths(
      await this.resolveVaultDirectory(normalized),
    );
    const inspection = await inspectDatabaseFile(
      this.app.vault.adapter,
      paths.databasePath,
    );
    if (
      inspection.exists ||
      (await this.hasRecoveryCandidate(paths.databasePath))
    ) {
      throw new Error(t("ui.the_selected_directory_already_contains_rss_reader_sqlite3_load_it_inste"));
    }
    await this.activateInitialDatabase(normalized, true);
  }

  async loadDatabase(directory: string): Promise<void> {
    const normalized = normalizeDirectory(directory);
    if (this.isDatabaseReady()) {
      if (normalized === this.settings.dataDirectory) {
        return;
      }
      throw new Error(t("ui.a_database_is_already_running_use_the_data_directory_switch_controls"));
    }
    const inspection = await this.inspectDataDirectory(normalized);
    const path = databasePaths(
      await this.resolveVaultDirectory(normalized),
    ).databasePath;
    if (
      !inspection.valid &&
      !(await this.hasRecoveryCandidate(path))
    ) {
      throw new Error(
        inspection.error ?? t("ui.the_selected_directory_does_not_contain_rss_reader_sqlite3"),
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
        throw new Error(t("ui.the_selected_directory_is_already_the_current_data_directory"));
      }
      const targetPaths = databasePaths(
        await this.resolveVaultDirectory(normalized),
      );
      if (targetPaths.databasePath === current.database.path) {
        throw new Error(t("ui.the_selected_directory_points_to_the_current_data_directory"));
      }
      const targetInspection = await inspectDatabaseFile(
        this.app.vault.adapter,
        targetPaths.databasePath,
      );

      if (mode === "migrate") {
        if (targetInspection.exists) {
          throw new Error(t("ui.the_target_directory_already_contains_rss_reader_sqlite3_migration_will_"));
        }
      } else if (
        !targetInspection.valid &&
        !(await this.hasRecoveryCandidate(targetPaths.databasePath))
      ) {
        throw new Error(
          targetInspection.error ?? t("ui.the_target_directory_does_not_contain_a_valid_rss_reader_sqlite3_to_load"),
        );
      }

      await this.createProtectionBackup("before-switch");
      await current.database.drain();
      if (mode === "migrate") {
        await current.database.backup(targetPaths.databasePath);
        const copied = await inspectDatabaseFile(
          this.app.vault.adapter,
          targetPaths.databasePath,
        );
        if (!copied.valid) {
          throw new Error(copied.error ?? t("ui.the_migrated_database_failed_validation"));
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
      this.refreshSettings();
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
      await Promise.all([
        context.feedService.stop(),
        context.recommendationService.stop(),
        context.translationService.stop(),
        context.llmService.stop(),
      ]);
      const backupDirectory = this.getCurrentBackupDirectory();
      if (!backupDirectory) {
        throw new Error(t("ui.configure_and_load_a_database_first"));
      }
      const entries = await this.app.vault.adapter
        .list(backupDirectory)
        .then((listed) => listed.files)
        .catch(() => []);
      const candidates = await Promise.all(
        entries
          .filter((path) =>
            /^(before-|manual-).*\.(sqlite3|sqlite|db)$/i.test(
              path.split("/").slice(-1)[0] ?? "",
            ),
          )
          .map(async (path) => {
            const fileStat = await this.app.vault.adapter.stat(path);
            return { path, modifiedAt: fileStat?.mtime ?? 0 };
          }),
      );
      const ordered = candidates.sort(
        (left, right) => right.modifiedAt - left.modifiedAt,
      );
      let source: string | null = null;
      for (const candidate of ordered) {
        if (
          (
            await inspectDatabaseFile(
              this.app.vault.adapter,
              candidate.path,
            )
          ).valid
        ) {
          source = candidate.path;
          break;
        }
      }
      if (!source) {
        throw new Error(t("ui.no_valid_database_backup_was_found_in_the_current_data_directory_s_backu"));
      }
      await this.createProtectionBackup("before-restore");
      await context.database.drain();
      await context.database.restoreFromFile(source);
      await context.translationService.initialize();
      this.databaseError = null;
      restoredSource = source;
    } finally {
      releaseTransition();
      context.llmService.resume();
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
    await this.runUpdateWithNotice(
      t("ui.automatic_startup_update"),
      true,
    );
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
      this.refreshSettings();
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
    this.refreshSettings();
    await this.refreshViews();
    const path = databasePaths(
      await this.resolveVaultDirectory(directory),
    ).databasePath;
    const previous = this.context;
    let next: ServiceContext | null = null;
    try {
      next = await this.buildContext(path, createIfMissing);
      await this.saveData({ ...this.settings, dataDirectory: directory });
      this.context = next;
      next = null;
      this.settings.dataDirectory = directory;
      this.databaseState = "ready";
      this.automaticUpdateStarted = false;
      this.refreshSettings();
      if (previous && previous !== this.context) {
        await this.disposeContext(previous).catch(() => undefined);
      }
      await this.refreshViews();
    } catch (error) {
      await this.disposeContext(next);
      this.databaseState = "error";
      this.databaseError =
        error instanceof Error ? error.message : String(error);
      this.refreshSettings();
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
      throw new Error(t("ui.could_not_access_the_workspace_window"));
    }
    const database = new RssDatabase(
      this.app.vault.adapter,
      databasePath,
      undefined,
      (error) => this.handleDatabaseStorageFailure(databasePath, error),
    );
    try {
      await database.initialize({ createIfMissing });
      const recovery = database.recovery;
      if (recovery?.recovered) {
        new Notice(t("database.recovered", {
          source:
            recovery.source === "temporary"
              ? t("database.temporary_snapshot")
              : t("database.previous_snapshot"),
        }), 10_000);
      }
      const repository = new RssRepository(database);
      const identityRepair = await repository.repairLegacyItemIdentity();
      if (identityRepair.removedItems > 0) {
        new Notice(t("database.identity_repaired", {
          count: identityRepair.removedItems,
        }), 8_000);
      }
      database.setOperationCoordinator(this.operationCoordinator);
      const translationService = new TranslationService(
        repository,
        new GoogleWebTranslationProvider(),
        () => this.settings,
        timerWindow,
        this.operationCoordinator,
        (error) => {
          new Notice(t("translation.task_failed", {
            error: error instanceof Error ? error.message : String(error),
          }), 10_000);
        },
      );
      const recommendationService = new RecommendationService(
        repository,
        this.operationCoordinator,
        () =>
          new Promise<void>((resolve) => {
            timerWindow.setTimeout(resolve, 0);
          }),
        () => this.settings,
      );
      const feedService = new FeedService(
        repository,
        () => this.settings,
        {
          onFeedsUpdated: async () => {
            try {
              await recommendationService.rebuild();
            } catch {
              // The feed update remains successful when training data is
              // insufficient; the recommendation model stores that state.
            }
          },
          onSettingsChanged: async () => this.refreshViews(),
          onCancelled: () => recommendationService.cancelTraining(),
        },
        timerWindow,
        this.operationCoordinator,
      );
      const context: ServiceContext = {
        database,
        repository,
        feedService,
        translationService,
        recommendationService,
        llmService: new LlmService(
          repository,
          () => this.settings,
          () => this.getLlmApiKey(),
          this.operationCoordinator,
          timerWindow,
        ),
        unsubscribeTranslation: () => undefined,
      };
      context.unsubscribeTranslation = translationService.onChange((change: TranslationChange) => {
        for (const leaf of this.app.workspace.getLeavesOfType(
          RSS_READER_VIEW_TYPE,
        )) {
          if (leaf.view instanceof RssReaderView) {
            leaf.view.refreshTranslatedTitle(
              change.itemId,
              change.field,
              change.targetLanguage,
              change.status,
            );
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
      throw new Error(t("ui.configure_and_load_a_database_first"));
    }
    const destination = normalizePath(
      `${backupDirectory}/${prefix}-${fileTimestamp()}.sqlite3`,
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
    await Promise.all([
      context.feedService.stop(),
      context.recommendationService.stop(),
      context.translationService.stop(),
      context.llmService.stop(),
    ]);
    let drainError: unknown;
    try {
      await context.database.drain();
    } catch (error) {
      drainError = error;
    }
    context.database.close();
    if (this.context === context) {
      this.context = null;
    }
    if (drainError) {
      throw drainError instanceof Error
        ? drainError
        : new Error(
            typeof drainError === "string"
              ? drainError
              : t("ui.unknown_error"),
          );
    }
  }

  private async hasRecoveryCandidate(databasePath: string): Promise<boolean> {
    return (
      await Promise.all(
        [".tmp", ".previous", ".incoming", ".rollback"].map((suffix) =>
          this.app.vault.adapter.exists(`${databasePath}${suffix}`),
        ),
      )
    ).some(Boolean);
  }

  private handleDatabaseStorageFailure(
    databasePath: string,
    error: Error,
  ): void {
    if (this.context?.database.path !== databasePath) {
      return;
    }
    this.databaseState = "error";
    this.databaseError = error.message;
    this.refreshSettings();
    void this.context.translationService.stop();
    new Notice(error.message, 0);
    void this.refreshViews().catch(() => undefined);
  }

  private requireContext(): ServiceContext {
    if (!this.context || this.databaseState !== "ready") {
      throw new Error(t("ui.select_and_load_a_data_directory_in_the_reader_settings_first"));
    }
    return this.context;
  }

  private async runUpdateWithNotice(
    trigger: string,
    automatic = false,
  ): Promise<void> {
    if (!this.isDatabaseReady()) {
      new Notice(t("ui.select_and_load_a_data_directory_in_the_reader_settings_first_2"));
      return;
    }
    if (this.feedService.isUpdating()) {
      return;
    }
    const notice = new Notice(t("update.in_progress", { trigger }), 0);
    let skipped = 0;
    try {
      const results = await this.feedService.updateFeeds(undefined, {
        automatic,
        onSkipped: (count) => {
          skipped = count;
        },
        onProgress: ({ completed, total, feedName }) => {
          notice.setMessage(t("ui.updating_feeds_current_total_feed", {
            current: completed,
            total,
            feed: feedName,
          }));
        },
      });
      const newItems = results.reduce(
        (sum, result) => sum + result.newItems,
        0,
      );
      const failed = results.filter((result) => result.error).length;
      notice.setMessage(
        automatic && skipped > 0
          ? t("update.done_with_recent_skips", {
              trigger,
              newItems,
              failed,
              skipped,
            })
          : t("update.done", {
              trigger,
              newItems,
              failed,
            }),
      );
    } catch (error) {
      notice.setMessage(t("update.failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error),
      }));
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
    const value = normalizeDirectory(directory);
    return resolveVaultDirectoryPath(value);
  }

  private refreshSettings(): void {
    this.settingTab?.update();
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
