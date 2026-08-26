import {
  App,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
} from "obsidian";
import type { SettingDefinitionItem } from "obsidian";

import type RssReaderPlugin from "../main";
import { t } from "../i18n";
import { DirectorySuggest } from "./directory-suggest";

const DATABASE_FILE_NAME = ["rss", "reader.sqlite3"].join("-");
const SETTINGS_CLASS = "academic-rss-reader-settings";

type ThresholdKey =
  | "recommendationLowThreshold"
  | "recommendationHighThreshold";

export class RssReaderSettingTab extends PluginSettingTab {
  private directorySuggest: DirectorySuggest | null = null;
  private inspectionRequest = 0;
  private dataDirectoryDraft: string | null = null;
  private inspectionTimer: number | null = null;
  private saveTimer: number | null = null;
  private saveRefreshReader = false;

  constructor(app: App, private readonly plugin: RssReaderPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: t("ui.database_storage"),
        cls: SETTINGS_CLASS,
        items: [
          {
            name: t("ui.reader_data_directory"),
            render: (setting) => this.renderDatabaseSetting(setting),
          },
          {
            name: t("ui.currently_in_use"),
            desc: this.plugin.getCurrentDatabasePath() ?? "",
            visible: () => this.plugin.isDatabaseReady(),
          },
          {
            name: t("ui.database_protection"),
            desc: t(
              "ui.backups_are_stored_in_the_backups_subdirectory_of_the_current_data_direc",
            ),
            visible: () => this.plugin.isDatabaseReady(),
            render: (setting) => this.renderDatabaseProtection(setting),
          },
        ],
      },
      {
        type: "group",
        heading: t("ui.feed_updates"),
        cls: SETTINGS_CLASS,
        items: [
          {
            name: t("ui.update_automatically_when_opening_the_reader"),
            desc: t(
              "ui.after_each_app_launch_silently_update_all_enabled_feeds_in_the_backgroun",
            ),
            control: {
              type: "toggle",
              key: "autoUpdateOnStartup",
              defaultValue: true,
            },
          },
          {
            name: t("ui.days_before_hidden_items_expire"),
            desc: t(
              "ui.hidden_items_older_than_this_many_days_become_expired_during_the_next_fe",
            ),
            control: {
              type: "number",
              key: "hiddenExpireDays",
              defaultValue: 30,
              min: 1,
              step: 1,
              validate: (value) =>
                Number.isInteger(value) && value >= 1
                  ? undefined
                  : t("ui.hidden_expire_days_must_be_a_positive_integer"),
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("ui.paper_cards"),
        cls: SETTINGS_CLASS,
        items: [
          {
            name: t("ui.show_journal_on_paper_cards"),
            desc: t("ui.show_journal_on_paper_cards_description"),
            control: {
              type: "toggle",
              key: "cardShowJournal",
              defaultValue: true,
            },
          },
          {
            name: t("ui.show_authors_on_paper_cards"),
            desc: t("ui.show_authors_on_paper_cards_description"),
            control: {
              type: "toggle",
              key: "cardShowAuthors",
              defaultValue: false,
            },
          },
          {
            name: t("ui.show_publication_date_on_paper_cards"),
            desc: t("ui.show_publication_date_on_paper_cards_description"),
            control: {
              type: "toggle",
              key: "cardShowPublicationDate",
              defaultValue: false,
            },
          },
          {
            name: t("ui.show_doi_on_paper_cards"),
            desc: t("ui.show_doi_on_paper_cards_description"),
            control: {
              type: "toggle",
              key: "cardShowDoi",
              defaultValue: false,
            },
          },
          {
            name: t("ui.show_text_abstract_on_paper_cards"),
            desc: t("ui.show_text_abstract_on_paper_cards_description"),
            control: {
              type: "toggle",
              key: "cardShowAbstract",
              defaultValue: false,
            },
          },
          {
            name: t("ui.show_graphical_abstract_on_paper_cards"),
            desc: t("ui.show_graphical_abstract_on_paper_cards_description"),
            control: {
              type: "toggle",
              key: "cardShowGraphicalAbstract",
              defaultValue: true,
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("ui.experimental_web_translation"),
        cls: SETTINGS_CLASS,
        items: [
          {
            name: t("ui.target_language"),
            desc: `${t(
              "ui.uses_an_unofficial_google_web_endpoint_without_authentication_it_may_be_",
            )} ${t("ui.simplified_chinese_is_the_default_and_recommended_target")}`,
            control: {
              type: "dropdown",
              key: "targetLanguage",
              defaultValue: "zh-CN",
              options: {
                "zh-CN": t("ui.simplified_chinese"),
                en: t("ui.english"),
              },
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("ui.llm_recommendation_review"),
        cls: SETTINGS_CLASS,
        items: [
          {
            name: t("ui.api_endpoint"),
            control: {
              type: "text",
              key: "llmBaseUrl",
              placeholder: "HTTPS://api.OpenAI.com/v1",
            },
          },
          {
            name: t("ui.api_key"),
            desc: t(
              "ui.select_or_create_a_secretstorage_entry_data_json_stores_only_the_entry_n",
            ),
            render: (setting) => this.renderSecretSetting(setting),
          },
          {
            name: t("ui.model"),
            control: {
              type: "text",
              key: "llmModel",
              placeholder: "GPT-4.1-mini",
            },
          },
          {
            name: t("ui.additional_research_interests"),
            control: {
              type: "textarea",
              key: "userInterest",
            },
          },
          {
            name: t("ui.low_recommendation_threshold"),
            desc: t("ui.leave_blank_to_use_the_model_suggestion"),
            render: (setting) =>
              this.renderThresholdSetting(
                setting,
                "recommendationLowThreshold",
              ),
          },
          {
            name: t("ui.high_recommendation_threshold"),
            desc: t("ui.leave_blank_to_use_the_model_suggestion"),
            render: (setting) =>
              this.renderThresholdSetting(
                setting,
                "recommendationHighThreshold",
              ),
          },
          {
            name: t("ui.test_connection"),
            render: (setting) => this.renderConnectionTest(setting),
          },
        ],
      },
    ];
  }

  override setControlValue(key: string, value: unknown): void | Promise<void> {
    let refreshReader = false;
    switch (key) {
      case "autoUpdateOnStartup":
        if (typeof value !== "boolean") {
          return;
        }
        if (this.plugin.settings.autoUpdateOnStartup === value) {
          return;
        }
        this.plugin.settings.autoUpdateOnStartup = value;
        break;
      case "hiddenExpireDays":
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 1
        ) {
          return;
        }
        if (this.plugin.settings.hiddenExpireDays === value) {
          return;
        }
        this.plugin.settings.hiddenExpireDays = value;
        break;
      case "cardShowJournal":
      case "cardShowAuthors":
      case "cardShowPublicationDate":
      case "cardShowDoi":
      case "cardShowAbstract":
      case "cardShowGraphicalAbstract":
        if (typeof value !== "boolean") {
          return;
        }
        if (this.plugin.settings[key] === value) {
          return;
        }
        this.plugin.settings[key] = value;
        refreshReader = true;
        break;
      case "targetLanguage":
        if (value !== "zh-CN" && value !== "en") {
          return;
        }
        if (this.plugin.settings.targetLanguage === value) {
          return;
        }
        this.plugin.settings.targetLanguage = value;
        refreshReader = true;
        break;
      case "llmBaseUrl":
        if (typeof value !== "string") {
          return;
        }
        {
          const normalized = value.trim();
          if (this.plugin.settings.llmBaseUrl === normalized) {
            return;
          }
          this.plugin.settings.llmBaseUrl = normalized;
        }
        break;
      case "llmModel":
        if (typeof value !== "string") {
          return;
        }
        {
          const normalized = value.trim();
          if (this.plugin.settings.llmModel === normalized) {
            return;
          }
          this.plugin.settings.llmModel = normalized;
        }
        break;
      case "userInterest":
        if (typeof value !== "string") {
          return;
        }
        {
          const normalized = value.trim();
          if (this.plugin.settings.userInterest === normalized) {
            return;
          }
          this.plugin.settings.userInterest = normalized;
        }
        break;
      default:
        return super.setControlValue(key, value);
    }
    this.scheduleSaveSettings(refreshReader);
  }

  private renderDatabaseSetting(setting: Setting): () => void {
    const dataDirectory =
      this.dataDirectoryDraft ?? this.plugin.settings.dataDirectory;
    let selectedDirectory = dataDirectory;

    setting.setDesc(
      t(
        "ui.choose_a_data_directory_inside_the_current_vault_the_active_database_is_",
      ),
    );
    setting.descEl.createEl("code", { text: DATABASE_FILE_NAME });
    setting.descEl.appendText(
      t("ui.and_all_protective_backups_are_stored_in_the_backups_subdirectory"),
    );
    setting.descEl.createEl("br");
    setting.descEl.appendText(
      t(
        "ui.enter_a_path_relative_to_the_vault_root_entering_a_path_does_not_create_",
      ),
    );
    setting.descEl.createEl("br");
    setting.descEl.appendText(
      t(
        "ui.load_an_existing_valid_database_or_create_one_when_none_exists_switching",
      ),
    );

    const inspection = setting.descEl.createEl("p", {
      cls: "setting-item-description",
      text: this.databaseStatusText(),
      attr: {
        role: "status",
        "aria-live": "polite",
      },
    });

    setting.addText((text) => {
      text
        .setPlaceholder("Assets/RSS reader data")
        .setValue(dataDirectory)
        .onChange((value) => {
          selectedDirectory = value;
          this.dataDirectoryDraft = value;
          this.updateDirectoryInspection(value, inspection);
        });
      this.directorySuggest?.close();
      const suggest = new DirectorySuggest(
        this.app,
        text.inputEl,
        this.plugin.getVaultAdapter(),
        (value) => {
          selectedDirectory = value;
          this.dataDirectoryDraft = value;
          this.updateDirectoryInspection(value, inspection);
        },
      );
      this.directorySuggest = suggest;
    });

    if (this.plugin.isDatabaseReady()) {
      setting.addButton((button) =>
        button.setButtonText(t("ui.migrate_current_database")).onClick(() => {
          this.runButtonAction(button.buttonEl, () =>
            this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(selectedDirectory, "migrate"),
            ),
          );
        }),
      );
      setting.addButton((button) =>
        button.setButtonText(t("ui.load_target_database")).onClick(() => {
          this.runButtonAction(button.buttonEl, () =>
            this.runDatabaseAction(() =>
              this.plugin.switchDataDirectory(selectedDirectory, "load"),
            ),
          );
        }),
      );
    } else {
      setting.addButton((button) =>
        button.setButtonText(t("ui.create_new_database")).onClick(() => {
          this.runButtonAction(button.buttonEl, () =>
            this.runDatabaseAction(() =>
              this.plugin.createDatabase(selectedDirectory),
            ),
          );
        }),
      );
      setting.addButton((button) =>
        button
          .setButtonText(t("ui.load_database"))
          .setCta()
          .onClick(() => {
            this.runButtonAction(button.buttonEl, () =>
              this.runDatabaseAction(() =>
                this.plugin.loadDatabase(selectedDirectory),
              ),
            );
          }),
      );
    }

    if (this.plugin.databaseError) {
      setting.descEl.createEl("p", {
        cls: "rss-reader__warning",
        text: t("database.load_error", {
          error: this.plugin.databaseError,
        }),
        attr: {
          role: "alert",
        },
      });
    }

    const suggestToClose = this.directorySuggest;
    return () => {
      if (this.directorySuggest === suggestToClose) {
        this.directorySuggest = null;
      }
      suggestToClose?.close();
      this.inspectionRequest += 1;
      if (this.inspectionTimer !== null) {
        this.getTimerWindow()?.clearTimeout(this.inspectionTimer);
        this.inspectionTimer = null;
      }
      this.flushScheduledSaveSettings();
    };
  }

  private renderDatabaseProtection(setting: Setting): void {
    setting.addButton((button) =>
      button.setButtonText(t("ui.back_up_now")).onClick(() => {
        this.runButtonAction(button.buttonEl, async () => {
          const destination = await this.plugin.createManualBackup();
          new Notice(t("database.backed_up", { destination }), 10_000);
        });
      }),
    );
    setting.addButton((button) =>
      button.setButtonText(t("ui.restore_latest_backup")).onClick(() => {
        this.runButtonAction(button.buttonEl, async () => {
          const source = await this.plugin.restoreLatestDatabaseBackup();
          new Notice(t("database.restored", { source }), 10_000);
          this.update();
        });
      }),
    );
  }

  private renderSecretSetting(setting: Setting): void {
    setting.addComponent((container) =>
      new SecretComponent(this.app, container)
        .setValue(this.plugin.settings.llmSecretId)
        .onChange((value) => {
          if (this.plugin.settings.llmSecretId === value) {
            return;
          }
          this.plugin.settings.llmSecretId = value;
          this.scheduleSaveSettings();
        }),
    );
  }

  private renderThresholdSetting(
    setting: Setting,
    key: ThresholdKey,
  ): void {
    setting.addText((text) =>
      text
        .setPlaceholder(key === "recommendationLowThreshold" ? "30" : "70")
        .setValue(this.plugin.settings[key]?.toString() ?? "")
        .onChange((value) => {
          const next = thresholdOrNull(value);
          if (this.plugin.settings[key] === next) {
            return;
          }
          this.plugin.settings[key] = next;
          this.scheduleSaveSettings(true);
        }),
    );
  }

  private renderConnectionTest(setting: Setting): void {
    setting.addButton((button) =>
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
      return t(
        "ui.the_database_is_ready_enter_another_directory_to_migrate_the_current_dat",
      );
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
      ? t(
          "ui.the_data_directory_is_saved_reader_will_try_to_load_its_database_when_op",
        )
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
    if (this.inspectionTimer !== null) {
      this.getTimerWindow()?.clearTimeout(this.inspectionTimer);
    }
    const timerWindow = this.getTimerWindow();
    if (!timerWindow) {
      return;
    }
    this.inspectionTimer = timerWindow.setTimeout(() => {
      this.inspectionTimer = null;
      this.runAsync(async () => {
        const message = await this.inspectDirectoryText(directory);
        if (request === this.inspectionRequest && inspection.isConnected) {
          inspection.setText(message);
        }
      });
    }, 250);
  }

  private scheduleSaveSettings(refreshReader = false): void {
    this.saveRefreshReader ||= refreshReader;
    const timerWindow = this.getTimerWindow();
    if (!timerWindow) {
      const shouldRefreshReader = this.saveRefreshReader;
      this.saveRefreshReader = false;
      this.runAsync(() => this.plugin.saveSettings(shouldRefreshReader));
      return;
    }
    if (this.saveTimer !== null) {
      timerWindow.clearTimeout(this.saveTimer);
    }
    this.saveTimer = timerWindow.setTimeout(() => {
      this.saveTimer = null;
      const shouldRefreshReader = this.saveRefreshReader;
      this.saveRefreshReader = false;
      this.runAsync(() => this.plugin.saveSettings(shouldRefreshReader));
    }, 250);
  }

  private flushScheduledSaveSettings(): void {
    if (this.saveTimer === null) {
      return;
    }
    this.getTimerWindow()?.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const shouldRefreshReader = this.saveRefreshReader;
    this.saveRefreshReader = false;
    this.runAsync(() => this.plugin.saveSettings(shouldRefreshReader));
  }

  private getTimerWindow(): Window | null {
    return this.app?.workspace?.containerEl?.ownerDocument?.defaultView ?? null;
  }

  private async runDatabaseAction(
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
      this.dataDirectoryDraft = null;
      new Notice(t("ui.database_operation_completed"));
    } catch (error) {
      this.showError(error);
    } finally {
      this.update();
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
