import {
  ButtonComponent,
  Component,
  Modal,
  Notice,
  Setting,
  setIcon,
} from "obsidian";

import { t } from "../i18n";
import type {
  Feed,
  FeedInput,
  RssItem,
} from "../models/domain";
import type RssReaderPlugin from "../main";
import { errorMessage, runUiAction } from "./ui-action";

export interface RecommendationModalCallbacks {
  onChanged: () => void | Promise<void>;
  onLowRecommendationsHidden: (
    itemIds: number[],
    changed: number,
  ) => void | Promise<void>;
}

export function confirmGoogleTranslation(
  app: RssReaderPlugin["app"],
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new GoogleTranslationConsentModal(app, resolve);
    modal.open();
  });
}

class GoogleTranslationConsentModal extends Modal {
  private resolved = false;

  constructor(
    app: RssReaderPlugin["app"],
    private readonly resolveChoice: (accepted: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("ui.enable_experimental_title_translation"));
    this.contentEl.createEl("p", {
      text: t(
        "ui.when_enabled_titles_in_the_current_viewport_and_prefetched_titles_are_se",
      ),
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("ui.cancel")).onClick(() => this.finish(false)),
      )
      .addButton((button) =>
        button
          .setButtonText(t("ui.agree_and_enable"))
          .setCta()
          .onClick(() => this.finish(true)),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolveChoice(false);
    }
  }

  private finish(accepted: boolean): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolveChoice(accepted);
    this.close();
  }
}

export class FeedModal extends Modal {
  constructor(
    private readonly plugin: RssReaderPlugin,
    private readonly feed: Feed | null,
    private readonly onSaved: () => void | Promise<void>,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle(this.feed ? t("ui.edit_feed") : t("ui.add_feed"));
    let journalName = this.feed?.journalName ?? "";
    let url = this.feed?.url ?? "";
    let enabled = this.feed?.enabled ?? true;
    new Setting(this.contentEl)
      .setName(t("ui.journal"))
      .setDesc(t("ui.journal_name_used_when_rss_does_not_provide_one"))
      .addText((text) =>
        text.setValue(journalName).onChange((value) => {
          journalName = value;
        }),
      );
    new Setting(this.contentEl)
      .setName(t("ui.rss_url"))
      .addText((text) =>
        text.setValue(url).onChange((value) => {
          url = value;
        }),
      );
    new Setting(this.contentEl).setName(t("ui.enabled")).addToggle((toggle) =>
      toggle.setValue(enabled).onChange((value) => {
        enabled = value;
      }),
    );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(t("ui.save"))
        .setCta()
        .onClick(() => {
          runUiAction(async () => {
            const input = {
              name: journalName,
              journalName,
              url,
              enabled,
            };
            if (this.feed) {
              await this.plugin.feedService.updateFeed(this.feed.id, input);
            } else {
              await this.plugin.feedService.addFeed(input);
            }
            this.close();
            await this.onSaved();
          }, button.buttonEl);
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class FeedImportModal extends Modal {
  private eventScope: Component | null = null;

  constructor(
    private readonly plugin: RssReaderPlugin,
    private readonly onSaved: () => void | Promise<void>,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const eventScope = new Component();
    eventScope.load();
    this.eventScope = eventScope;
    this.setTitle(t("ui.bulk_import_feeds"));
    this.contentEl.createEl("p", {
      text: t(
        "ui.supports_opml_xml_txt_pasted_content_or_one_url_per_line_duplicate_urls_",
      ),
    });
    const file = this.contentEl.createEl("input", {
      type: "file",
      attr: { accept: ".opml,.xml,.txt,.rtf" },
    });
    const textarea = this.contentEl.createEl("textarea", {
      cls: "rss-reader__import-text",
      attr: { placeholder: t("ui.paste_opml_or_rss_urls") },
    });
    const preview = this.contentEl.createDiv();
    preview.setAttribute("role", "status");
    preview.setAttribute("aria-live", "polite");
    let candidates: FeedInput[] = [];
    const updatePreview = async (): Promise<void> => {
      let content = textarea.value;
      const selected = file.files?.[0];
      if (selected) {
        content = `${await selected.text()}\n${content}`;
      }
      candidates = this.plugin.feedService.parseImportText(content);
      preview.setAttribute("role", "status");
      preview.setText(t("feed.candidates", { count: candidates.length }));
    };
    const showPreviewError = (error: unknown): void => {
      preview.setText(
        t("feed.preview_failed", { error: errorMessage(error) }),
      );
      preview.setAttribute("role", "alert");
    };
    eventScope.registerDomEvent(textarea, "change", () => {
      runUiAction(updatePreview, undefined, showPreviewError);
    });
    eventScope.registerDomEvent(file, "change", () => {
      runUiAction(updatePreview, undefined, showPreviewError);
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("ui.preview")).onClick(() => {
          runUiAction(
            updatePreview,
            button.buttonEl,
            showPreviewError,
          );
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(t("ui.import"))
          .setCta()
          .onClick(() => {
            runUiAction(async () => {
              await updatePreview();
              const result =
                await this.plugin.feedService.importFeeds(candidates);
              new Notice(t("feed.import_done", {
                added: result.added,
                repaired: result.repaired,
                skipped: result.skipped,
                failed: result.errors.length,
              }));
              this.close();
              await this.onSaved();
            }, button.buttonEl, showPreviewError);
          }),
      );
  }

  onClose(): void {
    this.eventScope?.unload();
    this.eventScope = null;
    this.contentEl.empty();
  }
}

export class GraphicalAbstractModal extends Modal {
  private eventScope: Component | null = null;

  constructor(
    private readonly plugin: RssReaderPlugin,
    private readonly item: Pick<RssItem, "imageUrl" | "title">,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const eventScope = new Component();
    eventScope.load();
    this.eventScope = eventScope;
    this.modalEl.addClass("rss-reader__image-modal");
    this.setTitle(t("ui.graphical_abstract"));
    if (!this.item.imageUrl) {
      return;
    }
    const frame = this.contentEl.createDiv({
      cls: "rss-reader__image-modal-frame",
    });
    const image = frame.createEl("img", {
      attr: {
        alt: t("ui.graphical_abstract_for", {
          title: this.item.title,
        }),
        src: this.item.imageUrl,
      },
    });
    image.decoding = "async";
    eventScope.registerDomEvent(image, "error", () => {
      frame.empty();
      frame.createEl("p", {
        cls: "rss-reader__warning",
        text: t("ui.graphical_abstract_failed_to_load"),
        attr: { role: "alert" },
      });
    });
  }

  onClose(): void {
    this.eventScope?.unload();
    this.eventScope = null;
    this.contentEl.empty();
  }
}

export class RecommendationModal extends Modal {
  constructor(
    private readonly plugin: RssReaderPlugin,
    private readonly callbacks: RecommendationModalCallbacks,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("rss-reader__recommendation-modal");
    this.setTitle(t("ui.personalized_recommendations"));
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    const summary = this.plugin.repository.getRecommendationSummary();
    const table = this.contentEl.createEl("table", {
      cls: "rss-reader__recommendation-table",
      attr: {
        "aria-label": t("ui.personalized_recommendations"),
      },
    });
    const body = table.createEl("tbody");
    for (const [label, value] of [
      [t("ui.high_relevance"), summary.high],
      [t("ui.low_relevance"), summary.low],
      [t("ui.pending"), summary.pending],
      [t("ui.unscored"), summary.unscored],
    ]) {
      const row = body.createEl("tr");
      row.createEl("th", {
        attr: { scope: "row" },
        text: String(label),
      });
      row.createEl("td", { text: String(value ?? 0) });
    }
    if (summary.errorMessage) {
      this.contentEl.createEl("p", {
        cls: "rss-reader__warning",
        text: summary.errorMessage,
        attr: { role: "alert" },
      });
    }

    const actions = this.contentEl.createDiv({
      cls: "rss-reader__recommendation-modal-actions",
    });
    this.actionButton(
      actions,
      t("ui.update_keyword_recommendations"),
      "sparkles",
      async () => {
        const notice = new Notice(
          t("ui.preparing_to_update_keyword_recommendations"),
          0,
        );
        try {
          await this.yieldToModal();
          const result = await this.plugin.recommendationService.rebuild(
            (message) => notice.setMessage(message),
          );
          notice.setMessage(t("recommendation.updated", {
            high: result.highCount,
            pending: result.pendingCount,
            low: result.lowCount,
          }));
        } catch (error) {
          notice.setMessage(errorMessage(error));
        } finally {
          this.modalWindow()?.setTimeout(() => notice.hide(), 5000);
          await this.callbacks.onChanged();
          this.render();
        }
      },
      this.plugin.recommendationService.isBusy() ||
        this.plugin.llmService.isBusy(),
    );
    this.actionButton(
      actions,
      t("ui.review_pending_items_with_llm"),
      "bot",
      async () => {
        const notice = new Notice(t("ui.reviewing_pending_papers"), 0);
        try {
          const result = await this.plugin.llmService.reviewPending();
          notice.setMessage(t("recommendation.reviewed", {
            high: result.high,
            low: result.low,
            failed: result.failed,
          }));
        } catch (error) {
          notice.setMessage(errorMessage(error));
        } finally {
          this.modalWindow()?.setTimeout(() => notice.hide(), 5000);
          await this.callbacks.onChanged();
          this.render();
        }
      },
      this.plugin.recommendationService.isBusy() ||
        this.plugin.llmService.isBusy(),
    );
    this.actionButton(actions, t("ui.keyword_list"), "list-tree", () => {
      new KeywordModal(this.plugin).open();
    });
    const lowIds = this.plugin.repository.listLowRecommendationIds("", []);
    this.actionButton(
      actions,
      t("recommendation.hide_low", { count: lowIds.length }),
      "eye-off",
      () => {
        new ConfirmModal(
          this.plugin.app,
          t("recommendation.hide_confirm", { count: lowIds.length }),
          async () => {
            const changed = await this.plugin.repository.setItemStatus(
              lowIds,
              "hidden",
            );
            await this.callbacks.onLowRecommendationsHidden(lowIds, changed);
            this.render();
          },
        ).open();
      },
      lowIds.length === 0,
    );
  }

  private actionButton(
    container: HTMLElement,
    label: string,
    icon: string,
    action: () => void | Promise<void>,
    disabled = false,
  ): HTMLButtonElement {
    const button = new ButtonComponent(container)
      .setButtonText(label)
      .setDisabled(disabled)
      .onClick(() => runUiAction(action, button.buttonEl));
    const iconEl = button.buttonEl.createSpan({
      cls: "rss-reader__recommendation-action-icon",
    });
    setIcon(iconEl, icon);
    button.buttonEl.prepend(iconEl);
    return button.buttonEl;
  }

  private modalWindow(): Window | null {
    return this.contentEl.ownerDocument.defaultView;
  }

  private async yieldToModal(): Promise<void> {
    const modalWindow = this.modalWindow();
    if (!modalWindow) {
      return;
    }
    await new Promise<void>((resolve) => {
      modalWindow.setTimeout(resolve, 0);
    });
  }
}

export class KeywordModal extends Modal {
  constructor(private readonly plugin: RssReaderPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("rss-reader__keyword-modal");
    this.setTitle(t("ui.recommendation_keywords"));
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t("keyword.table_help"),
    });
    const keywords = this.plugin.repository.listKeywords(100);
    const table = this.contentEl.createEl("table", {
      cls: "rss-reader__table",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const label of [
      t("ui.keyword"),
      t("ui.direction"),
      t("ui.weight"),
      t("ui.positive_samples"),
      t("ui.negative_samples"),
      t("ui.status"),
      t("ui.actions"),
    ]) {
      header.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const keyword of keywords) {
      const row = body.createEl("tr");
      for (const value of [
        keyword.keyword,
        keyword.effectiveWeight >= 0 ? t("ui.positive") : t("ui.negative"),
        keyword.effectiveWeight.toFixed(3),
        keyword.positiveCount,
        keyword.negativeCount,
        keyword.isDisabled
          ? t("ui.disabled")
          : t("ui.automatic"),
      ]) {
        row.createEl("td", { text: String(value) });
      }
      const actions = row.createEl("td", {
        cls: "rss-reader__table-actions",
      });
      const toggle = new ButtonComponent(actions)
        .setButtonText(
          keyword.isDisabled
            ? t("keyword.enable")
            : t("keyword.disable"),
        )
        .onClick(() => {
          runUiAction(async () => {
            await this.plugin.repository.setKeywordDisabled(
              keyword.keyword,
              !keyword.isDisabled,
            );
            this.render();
          }, toggle.buttonEl);
        });
      toggle.buttonEl.setAttribute(
        "aria-pressed",
        keyword.isDisabled ? "true" : "false",
      );
      toggle.buttonEl.addClass(
        keyword.isDisabled
          ? "rss-reader__keyword-enable"
          : "rss-reader__keyword-disable",
      );
    }
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: RssReaderPlugin["app"],
    private readonly message: string,
    private readonly onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("ui.confirm"));
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("ui.cancel")).onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText(t("ui.confirm_2"))
          .setClass("mod-warning")
          .onClick(() => {
            runUiAction(async () => {
              await this.onConfirm();
              this.close();
            }, button.buttonEl);
          }),
      );
  }
}
