import {
  App,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
} from "obsidian";

import type RssReaderPlugin from "../main";
import { t } from "../i18n";
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

    new Setting(containerEl).setName(t("ui.database_storage")).setHeading();
    const storageDescription = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    storageDescription.appendText(
      t("ui.choose_a_data_directory_inside_the_current_vault_the_active_database_is_"),
    );
    storageDescription.createEl("code", {
      text: DATABASE_FILE_NAME,
    });
    storageDescription.appendText(
      t("ui.and_all_protective_backups_are_stored_in_the_backups_subdirectory"),
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
      .setName(t("ui.reader_data_directory"))
      .setDesc(t("ui.enter_a_path_relative_to_the_vault_root_entering_a_path_does_not_create_"))
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
          button.setButtonText(t("ui.migrate_current_database")).onClick(() => {
            this.runButtonAction(button.buttonEl, () =>
              this.runDatabaseAction(() =>
                this.plugin.switchDataDirectory(dataDirectory, "migrate"),
              ),
            );
          }),
        )
        .addButton((button) =>
          button.setButtonText(t("ui.load_target_database")).onClick(() => {
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
          button.setButtonText(t("ui.create_new_database")).onClick(() => {
            this.runButtonAction(button.buttonEl, () =>
              this.runDatabaseAction(() =>
                this.plugin.createDatabase(dataDirectory),
              ),
            );
          }),
        )
        .addButton((button) =>
          button
            .setButtonText(t("ui.load_database"))
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
      text: t("ui.load_an_existing_valid_database_or_create_one_when_none_exists_switching"),
    });
    if (this.plugin.isDatabaseReady()) {
      new Setting(containerEl)
        .setName(t("ui.currently_in_use"))
        .setDesc(this.plugin.getCurrentDatabasePath() ?? "");
      new Setting(containerEl)
        .setName(t("ui.database_protection"))
        .setDesc(t("ui.backups_are_stored_in_the_backups_subdirectory_of_the_current_data_direc"))
        .addButton((button) =>
          button.setButtonText(t("ui.back_up_now")).onClick(() => {
            this.runButtonAction(button.buttonEl, async () => {
              const destination =
                await this.plugin.createManualBackup();
              new Notice(t("database.backed_up", { destination }), 10_000);
            });
          }),
        )
        .addButton((button) =>
          button.setButtonText(t("ui.restore_latest_backup")).onClick(() => {
            this.runButtonAction(button.buttonEl, async () => {
              const source =
                await this.plugin.restoreLatestDatabaseBackup();
              new Notice(t("database.restored", { source }), 10_000);
            });
          }),
        );
    }
    if (this.plugin.databaseError) {
      containerEl.createEl("p", {
        cls: "rss-reader__warning",
        text: t("database.load_error", {
          error: this.plugin.databaseError,
        }),
        attr: {
          role: "alert",
        },
      });
    }

    new Setting(containerEl).setName(t("ui.feed_updates")).setHeading();
    new Setting(containerEl)
      .setName(t("ui.update_automatically_when_opening_the_reader"))
      .setDesc(t("ui.after_each_app_launch_silently_update_all_enabled_feeds_in_the_backgroun"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoUpdateOnStartup)
          .onChange((value) => {
            this.plugin.settings.autoUpdateOnStartup = value;
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName(t("ui.days_before_hidden_items_expire"))
      .setDesc(t("ui.hidden_items_older_than_this_many_days_become_expired_during_the_next_fe"))
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

    new Setting(containerEl).setName(t("ui.experimental_web_translation")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("ui.uses_an_unofficial_google_web_endpoint_without_authentication_it_may_be_"),
    });
    new Setting(containerEl)
      .setName(t("ui.target_language"))
      .setDesc(t("ui.simplified_chinese_is_the_default_and_recommended_target"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("zh-CN", t("ui.simplified_chinese"))
        .addOption("en", t("ui.english"))
          .setValue(this.plugin.settings.targetLanguage)
          .onChange((value) => {
            this.plugin.settings.targetLanguage = value;
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl).setName(t("ui.llm_recommendation_review")).setHeading();
    new Setting(containerEl)
      .setName(t("ui.api_endpoint"))
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
      .setName(t("ui.api_key"))
      .setDesc(t("ui.select_or_create_a_secretstorage_entry_data_json_stores_only_the_entry_n"))
      .addComponent((container) =>
        new SecretComponent(this.app, container)
          .setValue(this.plugin.settings.llmSecretId)
          .onChange((value) => {
            this.plugin.settings.llmSecretId = value;
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName(t("ui.model"))
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
      .setName(t("ui.additional_research_interests"))
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.userInterest)
          .onChange((value) => {
            this.plugin.settings.userInterest = value.trim();
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName(t("ui.low_recommendation_threshold"))
      .setDesc(t("ui.leave_blank_to_use_the_model_suggestion"))
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(
            this.plugin.settings.recommendationLowThreshold?.toString() ??
              "",
          )
          .onChange((value) => {
            this.plugin.settings.recommendationLowThreshold =
              thresholdOrNull(value);
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName(t("ui.high_recommendation_threshold"))
      .setDesc(t("ui.leave_blank_to_use_the_model_suggestion"))
      .addText((text) =>
        text
          .setPlaceholder("70")
          .setValue(
            this.plugin.settings.recommendationHighThreshold?.toString() ??
              "",
          )
          .onChange((value) => {
            this.plugin.settings.recommendationHighThreshold =
              thresholdOrNull(value);
            this.runAsync(() => this.plugin.saveSettings());
          }),
      );
    new Setting(containerEl)
      .setName(t("ui.test_connection"))
      .addButton((button) =>
        button.setButtonText(t("ui.test")).onClick(() => {
          this.runButtonAction(button.buttonEl, async () => {
            if (!this.plugin.isDatabaseReady()) {
              throw new Error(t("ui.configure_and_load_a_database_first"));
            }
            new Notice(await this.plugin.llmService.testConnection());
          });
        }),
      );

  }

  private databaseStatusText(): string {
    if (this.plugin.databaseState === "ready") {
      return t("ui.the_database_is_ready_enter_another_directory_to_migrate_the_current_dat");
    }
    if (this.plugin.databaseState === "initializing") {
      return t("ui.initializing_database");
    }
    if (this.plugin.databaseState === "error") {
      return t("database.load_failed", {
        error: this.plugin.databaseError ?? t("ui.unknown_error"),
      });
    }
    return this.plugin.settings.dataDirectory
      ? t("ui.the_data_directory_is_saved_reader_will_try_to_load_its_database_when_op")
      : t("ui.no_data_directory_is_configured");
  }

  private async inspectDirectoryText(directory: string): Promise<string> {
    if (!directory.trim()) {
      return t("ui.enter_a_data_directory_inside_the_current_vault");
    }
    try {
      const result = await this.plugin.inspectDataDirectory(directory);
      if (!result.exists) {
        return t("ui.this_directory_has_no_database_you_can_create_a_new_one");
      }
      if (result.valid) {
        return t("ui.a_valid_rss_reader_sqlite3_was_found_and_can_be_loaded");
      }
      return t("database.validation_failed", {
        error: result.error ?? t("ui.unknown_error"),
      });
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
      new Notice(t("ui.database_operation_completed"));
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

function thresholdOrNull(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, parsed))
    : null;
}
