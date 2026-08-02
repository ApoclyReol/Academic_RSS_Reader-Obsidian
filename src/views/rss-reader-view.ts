import {
  ButtonComponent,
  ItemView,
  Modal,
  Notice,
  Setting,
  ToggleComponent,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import type RssReaderPlugin from "../main";
import { RSS_READER_VIEW_TYPE } from "../constants";
import { formatDate, formatNumber, t } from "../i18n";
import {
  ITEM_STATUSES,
  type Feed,
  type FeedInput,
  type ItemQuery,
  type ItemStatus,
  type RssItem,
} from "../models/domain";
import { statusLabel } from "./status-label";
import { executeUiAction } from "./ui-action";

type Page = "reader" | "feeds" | "analytics";

interface LastAction {
  itemIds: number[];
  fromStatus: ItemStatus;
  label: string;
}

const READER_BATCH_SIZE = 100;

export class RssReaderView extends ItemView {
  private page: Page = "reader";
  private status: ItemStatus = "unread";
  private lastAction: LastAction | null = null;
  private translationEnabled = false;
  private titleObserver: IntersectionObserver | null = null;
  private loadMoreObserver: IntersectionObserver | null = null;
  private requestedTitleIds = new Set<number>();
  private readerItems: RssItem[] = [];
  private readerMatched = 0;
  private readerList: HTMLElement | null = null;
  private readerCaption: HTMLElement | null = null;
  private readerSentinel: HTMLElement | null = null;
  private loadingMore = false;
  private rendering = false;
  private renderAgain = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: RssReaderPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return RSS_READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Academic RSS reader";
  }

  getIcon(): string {
    return "rss";
  }

  async onOpen(): Promise<void> {
    this.plugin.prepareDatabaseOnViewOpen();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.titleObserver?.disconnect();
    this.loadMoreObserver?.disconnect();
  }

  async refresh(): Promise<void> {
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    this.rendering = true;
    try {
      this.titleObserver?.disconnect();
      this.titleObserver = null;
      this.loadMoreObserver?.disconnect();
      this.loadMoreObserver = null;
      this.readerItems = [];
      this.readerMatched = 0;
      this.readerList = null;
      this.readerCaption = null;
      this.readerSentinel = null;
      this.loadingMore = false;
      const container = this.containerEl.children[1];
      if (!container?.instanceOf(HTMLElement)) {
        return;
      }
      container.empty();
      container.addClass("rss-reader");
      if (!this.plugin.isDatabaseReady()) {
        this.renderDatabaseSetup(container);
        return;
      }
      this.renderHeader(container);
      if (this.page === "reader") {
        this.renderReader(container);
      } else if (this.page === "feeds") {
        this.renderFeeds(container);
      } else {
        this.renderAnalytics(container);
      }
    } finally {
      this.rendering = false;
      if (this.renderAgain) {
        this.renderAgain = false;
        await this.refresh();
      }
    }
  }

  refreshTranslatedTitles(): void {
    if (!this.plugin.isDatabaseReady()) {
      return;
    }
    const cards = Array.from(
      this.containerEl.querySelectorAll(
        ".rss-reader__item[data-item-id]",
      ),
    );
    for (const card of cards) {
      if (!card.instanceOf(HTMLElement)) {
        continue;
      }
      const itemId = Number(card.dataset.itemId);
      const item = this.plugin.repository.getItem(
        itemId,
        this.plugin.settings.targetLanguage,
      );
      const title = card.querySelector(".rss-reader__item-title");
      if (!item || !title?.instanceOf(HTMLElement)) {
        continue;
      }
      title.empty();
      this.renderTitle(title, item);
    }
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "rss-reader__header" });
    const title = header.createDiv({ cls: "rss-reader__brand" });
    setIcon(title.createSpan(), "rss");
    title.createEl("h2", { text: "Academic RSS reader" });

    const navigation = header.createDiv({ cls: "rss-reader__navigation" });
    for (const [page, label, icon] of [
      ["reader", t("ui.reader"), "library-big"],
      ["feeds", t("ui.feeds"), "list-plus"],
      ["analytics", t("ui.interest_analysis"), "chart-column"],
    ] as Array<[Page, string, string]>) {
      const button = navigation.createEl("button", {
        cls: this.page === page ? "mod-cta" : "",
        attr:
          this.page === page
            ? { "aria-current": "page" }
            : {},
      });
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: label });
      button.addEventListener("click", () => {
        this.page = page;
        runUiAction(() => this.refresh(), button);
      });
    }
  }

  private renderDatabaseSetup(container: HTMLElement): void {
    const setup = container.createDiv({
      cls: "rss-reader__empty-state",
    });
    setup.createEl("h2", { text: t("ui.a_data_directory_is_required") });
    const message =
      this.plugin.databaseState === "initializing"
        ? t("ui.loading_the_reader_database")
        : this.plugin.databaseError
          ? t("error.database_not_loaded", {
              error: this.plugin.databaseError,
            })
          : t("ui.reader_does_not_create_a_database_in_the_plugin_directory_choose_a_data_");
    setup.createEl("p", { text: message });
    if (this.plugin.databaseState !== "initializing") {
      const button = setup.createEl("button", {
        cls: "mod-cta",
        text: t("ui.open_reader_settings"),
      });
      button.addEventListener("click", () => this.plugin.openSettings());
    }
  }

  private renderReader(container: HTMLElement): void {
    const counts = this.plugin.repository.countByStatus();
    const baskets = container.createDiv({ cls: "rss-reader__baskets" });
    for (const status of ITEM_STATUSES) {
      const button = baskets.createEl("button", {
        cls: this.status === status ? "rss-reader__basket is-active" : "rss-reader__basket",
        attr: {
          "aria-pressed": String(this.status === status),
        },
      });
      button.createSpan({ text: statusLabel(status) });
      button.createEl("strong", { text: String(counts[status]) });
      button.addEventListener("click", () => {
        this.status = status;
        runUiAction(() => this.refresh(), button);
      });
    }

    if (this.status === "unread") {
      this.renderRecommendation(container);
    }

    const query = {
      status: this.status,
      query: "",
      feedIds: [],
      limit: READER_BATCH_SIZE,
      offset: 0,
      targetLanguage: this.plugin.settings.targetLanguage,
    };
    this.readerMatched = this.plugin.repository.countItems(query);
    this.readerItems = this.plugin.repository.listItems(query);
    this.readerCaption = container.createEl("p", {
      cls: "rss-reader__caption",
      text: this.readerCaptionText(),
    });

    const actions = container.createDiv({
      cls: "rss-reader__mode-switch",
    });
    this.actionButton(actions, t("ui.refresh"), "refresh-cw", () => this.refresh());
    this.actionButton(
      actions,
      t("ui.undo"),
      "undo-2",
      async () => this.undoLastAction(),
      !this.lastAction,
    );
    const translateButton = this.actionButton(
      actions,
      this.translationEnabled ? t("ui.show_original") : t("ui.translate_titles"),
      "languages",
      async () => {
        if (
          !this.translationEnabled &&
          !this.plugin.settings.googleTranslationDisclosureAccepted &&
          !(await confirmGoogleTranslation(this.app))
        ) {
          return;
        }
        if (
          !this.translationEnabled &&
          !this.plugin.settings.googleTranslationDisclosureAccepted
        ) {
          this.plugin.settings.googleTranslationDisclosureAccepted = true;
          await this.plugin.saveSettings();
        }
        this.translationEnabled = !this.translationEnabled;
        if (!this.translationEnabled) {
          this.requestedTitleIds.clear();
        }
        await this.refresh();
      },
    );
    translateButton.toggleClass("is-active", this.translationEnabled);
    translateButton.setAttribute(
      "aria-pressed",
      String(this.translationEnabled),
    );

    if (this.readerItems.length === 0) {
      container.createDiv({
        cls: "rss-reader__empty-state",
        text: t("ui.there_are_no_papers_in_this_basket"),
      });
    } else {
      this.readerList = container.createDiv({ cls: "rss-reader__list" });
      for (const item of this.readerItems) {
        this.renderItemCard(this.readerList, item);
      }
      if (this.translationEnabled) {
        this.observeVisibleTitles(this.readerList, this.readerItems);
      }
      this.renderLoadMoreSentinel(container, query);
    }
  }

  private renderItemCard(container: HTMLElement, item: RssItem): void {
    const card = container.createDiv({ cls: "rss-reader__item" });
    card.dataset.itemId = String(item.id);
    const titleContainer = card.createDiv({ cls: "rss-reader__item-title" });
    this.renderTitle(titleContainer, item);
    if (item.journal) {
      card.createEl("p", {
        cls: "rss-reader__caption",
        text: item.journal,
      });
    }
    this.renderKeywordRelevance(card, item);
    const actions = card.createDiv({ cls: "rss-reader__item-actions" });
    this.renderStatusActions(actions, item);
    if (item.link) {
      this.actionButton(actions, t("ui.open_original"), "external-link", () => {
        this.viewWindow()?.open(item.link, "_external");
      });
    }
  }

  private renderLoadMoreSentinel(
    container: HTMLElement,
    query: ItemQuery,
  ): void {
    this.readerSentinel = container.createEl("p", {
      cls: "rss-reader__load-status",
      text:
        this.readerItems.length >= this.readerMatched
          ? t("ui.all_papers_loaded")
          : t("ui.scroll_down_to_load_more"),
      attr: {
        role: "status",
        "aria-live": "polite",
      },
    });
    if (this.readerItems.length >= this.readerMatched) {
      return;
    }
    const IntersectionObserverConstructor =
      container.ownerDocument.defaultView?.IntersectionObserver;
    if (!IntersectionObserverConstructor) {
      return;
    }
    this.loadMoreObserver = new IntersectionObserverConstructor(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          runUiAction(() => this.loadMoreReaderItems(query));
        }
      },
      {
        root: this.containerEl,
        rootMargin: "800px 0px",
        threshold: 0.01,
      },
    );
    this.loadMoreObserver.observe(this.readerSentinel);
  }

  private async loadMoreReaderItems(query: ItemQuery): Promise<void> {
    if (
      this.loadingMore ||
      !this.readerList ||
      !this.readerSentinel ||
      this.readerItems.length >= this.readerMatched
    ) {
      return;
    }
    this.loadingMore = true;
    this.readerSentinel.setText(t("ui.loading_more_papers"));
    this.readerSentinel.setAttribute("aria-busy", "true");
    try {
      await Promise.resolve();
      const existingIds = new Set(
        this.readerItems.map((item) => item.id),
      );
      const nextItems = this.plugin.repository
        .listItems({
          ...query,
          limit: READER_BATCH_SIZE,
          offset: this.readerItems.length,
        })
        .filter((item) => !existingIds.has(item.id));
      for (const item of nextItems) {
        this.readerItems.push(item);
        this.renderItemCard(this.readerList, item);
      }
      this.readerCaption?.setText(this.readerCaptionText());
      if (this.translationEnabled) {
        this.observeVisibleTitles(this.readerList, this.readerItems);
      }
      if (
        nextItems.length === 0 ||
        this.readerItems.length >= this.readerMatched
      ) {
        this.loadMoreObserver?.disconnect();
        this.readerSentinel.setText(t("ui.all_papers_loaded"));
      } else {
        this.readerSentinel.setText(t("ui.scroll_down_to_load_more"));
      }
    } finally {
      this.loadingMore = false;
      this.readerSentinel?.removeAttribute("aria-busy");
    }
  }

  private readerCaptionText(): string {
    return t("reader.basket_count", {
      total: formatNumber(this.readerMatched),
      shown: formatNumber(this.readerItems.length),
    });
  }

  private renderTitle(container: HTMLElement, item: RssItem): void {
    container.createEl("h3", {
      text:
        this.translationEnabled && item.translatedTitle
          ? item.translatedTitle
          : item.title,
    });
    if (
      this.translationEnabled &&
      item.titleTranslationStatus === "failed"
    ) {
      container.createSpan({
        cls: "rss-reader__translation-status is-error",
        text: t("ui.translation_failed"),
        attr: {
          role: "alert",
        },
      });
    } else if (
      this.translationEnabled &&
      item.titleTranslationStatus === "pending"
    ) {
      container.createSpan({
        cls: "rss-reader__translation-status",
        text: t("ui.waiting_for_translation"),
        attr: {
          role: "status",
          "aria-live": "polite",
        },
      });
    } else if (
      this.translationEnabled &&
      item.titleTranslationStatus === "translating"
    ) {
      container.createSpan({
        cls: "rss-reader__translation-status",
        text: t("ui.translating"),
        attr: {
          role: "status",
          "aria-live": "polite",
        },
      });
    }
  }

  private renderKeywordRelevance(
    container: HTMLElement,
    item: RssItem,
  ): void {
    if (item.keywordScore === null) {
      return;
    }
    const relevance = container.createDiv({
      cls: "rss-reader__item-relevance",
    });
    const tier = item.finalTier ?? "pending";
    const label =
      tier === "high"
        ? t("ui.high_relevance")
        : tier === "low"
          ? t("ui.low_relevance")
          : t("ui.pending");
    relevance.createSpan({
      cls: `rss-reader__keyword-relevance is-${tier}`,
      text: label,
      attr: {
        "aria-label": t("recommendation.aria", { label }),
      },
    });
    const explanation = recommendationExplanation(item.matchedKeywords);
    if (explanation.positive.length > 0) {
      relevance.createDiv({
        cls: "rss-reader__caption",
        text: t("recommendation.positive_terms", {
          terms: explanation.positive.join(", "),
        }),
      });
    }
    if (explanation.negative.length > 0) {
      relevance.createDiv({
        cls: "rss-reader__caption",
        text: t("recommendation.negative_terms", {
          terms: explanation.negative.join(", "),
        }),
      });
    }
    if (explanation.context.length > 0) {
      relevance.createDiv({
        cls: "rss-reader__caption",
        text: t("recommendation.feature_terms", {
          terms: explanation.context.join(", "),
        }),
      });
    }
  }

  private observeVisibleTitles(
    list: HTMLElement,
    items: RssItem[],
  ): void {
    const cards = Array.from(
      list.querySelectorAll<HTMLElement>(".rss-reader__item"),
    );
    const IntersectionObserverConstructor =
      list.ownerDocument.defaultView?.IntersectionObserver;
    if (!IntersectionObserverConstructor) {
      return;
    }
    this.titleObserver?.disconnect();
    this.titleObserver = new IntersectionObserverConstructor(
      (entries) => {
        const visibleIndexes = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) =>
            entry.target.instanceOf(HTMLElement)
              ? cards.indexOf(entry.target)
              : -1,
          )
          .filter((index) => index >= 0);
        if (visibleIndexes.length === 0) {
          return;
        }
        const lastPrefetchIndex = Math.min(
          items.length - 1,
          Math.max(...visibleIndexes) + 8,
        );
        const indexes = new Set(visibleIndexes);
        for (
          let index = Math.min(...visibleIndexes);
          index <= lastPrefetchIndex;
          index += 1
        ) {
          indexes.add(index);
        }
        for (const index of indexes) {
          const item = items[index];
          if (
            !item ||
            item.translatedTitle ||
            this.requestedTitleIds.has(item.id)
          ) {
            continue;
          }
          this.requestedTitleIds.add(item.id);
          runUiAction(
            () =>
              this.plugin.translationService.requestManual(
                item.id,
                "title",
                item.titleTranslationStatus === "failed",
              ),
            undefined,
            (error) => {
              this.requestedTitleIds.delete(item.id);
              new Notice(errorMessage(error), 10_000);
            },
          );
        }
      },
      {
        root: this.containerEl,
        rootMargin: "0px",
        threshold: 0.01,
      },
    );
    for (const card of cards) {
      this.titleObserver.observe(card);
    }
  }

  private renderStatusActions(
    container: HTMLElement,
    item: RssItem,
  ): void {
    const transitions = transitionsFor(item.itemStatus);
    for (const [label, status] of transitions) {
      this.actionButton(container, label, statusIcon(status), async () => {
        this.lastAction = {
          itemIds: [item.id],
          fromStatus: item.itemStatus,
          label: item.title,
        };
        await this.plugin.repository.setItemStatus([item.id], status);
        await this.refresh();
      });
    }
  }

  private renderRecommendation(container: HTMLElement): void {
    const panel = container.createEl("details", {
      cls: "rss-reader__recommendation",
    });
    panel.createEl("summary", { text: t("ui.personalized_recommendations") });
    const summary = this.plugin.repository.getRecommendationSummary();
    const metrics = panel.createDiv({ cls: "rss-reader__metrics" });
    for (const [label, value] of [
      [t("ui.high_relevance"), summary.high],
      [t("ui.pending"), summary.pending],
      [t("ui.low_relevance"), summary.low],
      [t("ui.unscored"), summary.unscored],
    ]) {
      const metric = metrics.createDiv({ cls: "rss-reader__metric" });
      metric.createSpan({ text: String(label) });
      metric.createEl("strong", { text: String(value ?? 0) });
    }
    if (summary.errorMessage) {
      panel.createEl("p", {
        cls: "rss-reader__warning",
        text: summary.errorMessage,
        attr: {
          role: "alert",
        },
      });
    } else if (summary.modelVersion) {
      panel.createEl("p", {
        cls: "rss-reader__caption",
        text: `${t("recommendation.model_summary", {
          positive: formatNumber(summary.positiveCount),
          negative: formatNumber(summary.negativeCount),
          unread: formatNumber(summary.unreadCount),
          accuracy:
            summary.validationAccuracy === null
              ? "—"
              : `${formatNumber(summary.validationAccuracy * 100)}%`,
          low: formatNumber(
            this.plugin.settings.recommendationLowThreshold ??
              summary.suggestedLowThreshold,
          ),
          high: formatNumber(
            this.plugin.settings.recommendationHighThreshold ??
              summary.suggestedHighThreshold,
          ),
          updated: summary.createdAt
            ? formatDate(summary.createdAt)
            : "",
        })}${this.plugin.recommendationService.isModelStale()
          ? t("recommendation.stale")
          : ""}`,
      });
    }
    const actions = panel.createDiv({ cls: "rss-reader__item-actions" });
    this.actionButton(actions, t("ui.update_keyword_recommendations"), "sparkles", async () => {
      const notice = new Notice(t("ui.preparing_to_update_keyword_recommendations"), 0);
      try {
        await this.yieldToView();
        const result = await this.plugin.recommendationService.rebuild(
          (message) => notice.setMessage(message),
        );
        notice.setMessage(t("recommendation.updated", {
          high: result.highCount,
          pending: result.pendingCount,
          low: result.lowCount,
        }));
      } catch (error) {
        notice.setMessage(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        this.viewWindow()?.setTimeout(() => notice.hide(), 5000);
        await this.refresh();
      }
    });
    this.actionButton(actions, t("ui.review_pending_items_with_llm"), "bot", async () => {
      const notice = new Notice(t("ui.reviewing_pending_papers"), 0);
      try {
        const result = await this.plugin.llmService.reviewPending();
        notice.setMessage(t("recommendation.reviewed", {
          high: result.high,
          low: result.low,
          failed: result.failed,
        }));
      } catch (error) {
        notice.setMessage(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        this.viewWindow()?.setTimeout(() => notice.hide(), 5000);
        await this.refresh();
      }
    });
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
          this.app,
          t("recommendation.hide_confirm", { count: lowIds.length }),
          async () => {
            const changed = await this.plugin.repository.setItemStatus(
              lowIds,
              "hidden",
            );
            this.lastAction = {
              itemIds: lowIds,
              fromStatus: "unread",
              label: t("recommendation.low_papers", { count: changed }),
            };
            await this.refresh();
          },
        ).open();
      },
      lowIds.length === 0,
    );
  }

  private renderFeeds(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "rss-reader__toolbar" });
    this.actionButton(actions, t("ui.add_feed"), "plus", () => {
      new FeedModal(this.plugin, null, () => this.refresh()).open();
    });
    this.actionButton(actions, t("ui.bulk_import"), "file-up", () => {
      new FeedImportModal(this.plugin, () => this.refresh()).open();
    });
    this.actionButton(actions, t("ui.update_all_enabled"), "refresh-cw", async () => {
      await this.runFeedUpdate();
    });
    this.actionButton(
      actions,
      t("feed.cancel_update"),
      "circle-stop",
      () => {
        this.plugin.feedService.cancelUpdates();
      },
      !this.plugin.feedService.isUpdating(),
    );

    const rawSummary =
      this.plugin.repository.getMetadata("last_update_summary");
    if (rawSummary) {
      const parsedSummary = safeJson(rawSummary);
      const summary =
        parsedSummary &&
        typeof parsedSummary === "object" &&
        !Array.isArray(parsedSummary)
          ? (parsedSummary as Record<string, unknown>)
          : {};
      container.createEl("p", {
        cls: "rss-reader__caption",
        text: t("feed.last_summary", {
          date: primitiveText(summary.finishedAt, ""),
          success: primitiveText(summary.successFeeds, "0"),
          total: primitiveText(summary.totalFeeds, "0"),
          newItems: primitiveText(summary.totalNewItems, "0"),
          expired: primitiveText(summary.expiredItems, "0"),
        }),
      });
    }

    const feeds = this.plugin.repository.listFeeds(true);
    if (feeds.length === 0) {
      container.createDiv({
        cls: "rss-reader__empty-state",
        text: t("ui.no_feeds_yet"),
      });
      return;
    }
    const table = container.createEl("table", {
      cls: "rss-reader__table rss-reader__table--compact",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const label of [
      t("ui.name"),
      t("ui.enabled"),
      t("ui.items"),
      t("feed.last_success"),
      t("feed.health"),
      t("feed.next_attempt"),
      t("ui.error"),
      t("ui.actions"),
    ]) {
      header.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const feed of feeds) {
      const row = body.createEl("tr");
      row.createEl("td", { text: feed.name });
      const enabledCell = row.createEl("td");
      new ToggleComponent(enabledCell)
        .setValue(feed.enabled)
        .setTooltip(feed.enabled ? t("ui.disable_feed") : t("ui.enable_feed"))
        .onChange((enabled) => {
          runUiAction(async () => {
            await this.plugin.feedService.updateFeed(feed.id, {
              name: feed.name,
              url: feed.url,
              enabled,
            });
            await this.refresh();
          });
        });
      row.createEl("td", { text: String(feed.itemCount) });
      row.createEl("td", {
        text: feed.lastSuccessAt ? formatDate(feed.lastSuccessAt) : "—",
      });
      row.createEl("td", {
        text:
          feed.healthStatus === "healthy"
            ? t("feed.health_healthy")
            : t(
                feed.healthStatus === "failing"
                  ? "feed.health_failing"
                  : "feed.health_degraded",
                { count: feed.consecutiveFailures },
              ),
      });
      row.createEl("td", {
        text: feed.nextAutoUpdateAt
          ? formatDate(feed.nextAutoUpdateAt)
          : "—",
      });
      row.createEl("td", { text: feed.lastError ?? "" });
      const rowActions = row.createEl("td", {
        cls: "rss-reader__table-actions",
      });
      this.actionButton(rowActions, t("ui.edit"), "pencil", () => {
        new FeedModal(this.plugin, feed, () => this.refresh()).open();
      });
      this.actionButton(rowActions, t("ui.update"), "refresh-cw", async () => {
        await this.runFeedUpdate([feed.id]);
      });
      this.actionButton(rowActions, t("ui.delete"), "trash-2", () => {
        new ConfirmModal(
          this.app,
          t("feed.delete_confirm", { name: feed.name }),
          async () => {
            await this.plugin.repository.deleteFeeds([feed.id]);
            await this.refresh();
          },
        ).open();
      });
    }
  }

  private renderAnalytics(container: HTMLElement): void {
    const counts = this.plugin.repository.countByStatus();
    const metrics = container.createDiv({ cls: "rss-reader__metrics" });
    for (const [label, value] of [
      [t("ui.total_items"), counts.total],
      [t("ui.unread"), counts.unread],
      [t("ui.hide"), counts.hidden],
      [t("ui.interested"), counts.interested],
      [t("ui.archived"), counts.archived],
      [t("ui.expired_2"), counts.expired],
    ]) {
      const metric = metrics.createDiv({ cls: "rss-reader__metric" });
      metric.createSpan({ text: String(label) });
      metric.createEl("strong", { text: String(value ?? 0) });
    }
    container.createEl("p", {
      cls: "rss-reader__caption",
      text: t("analytics.expiry", {
        days: this.plugin.settings.hiddenExpireDays,
      }),
    });
    const rows: Array<Record<string, unknown> & { rate: number }> =
      this.plugin.repository
      .listFeedStats()
      .map((row) => {
        const interested = Number(row.interested_count ?? 0);
        const archived = Number(row.archived_count ?? 0);
        const hidden = Number(row.hidden_count ?? 0);
        const denominator = interested + archived + hidden;
        return {
          ...row,
          rate: denominator ? (interested + archived) / denominator : 0,
        };
      })
      .sort((left, right) => right.rate - left.rate);
    const table = container.createEl("table", {
      cls: "rss-reader__table rss-reader__table--compact",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const label of [
      t("ui.journal"),
      t("ui.enabled"),
      t("ui.total_items"),
      t("ui.unread"),
      t("ui.hide"),
      t("ui.interested"),
      t("ui.archived"),
      t("ui.expired_2"),
      t("ui.interest_rate"),
    ]) {
      header.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const row of rows) {
      const tr = body.createEl("tr");
      for (const value of [
        row.name,
        row.enabled ? t("ui.yes") : t("ui.no"),
        row.total_count ?? 0,
        row.unread_count ?? 0,
        row.hidden_count ?? 0,
        row.interested_count ?? 0,
        row.archived_count ?? 0,
        row.expired_count ?? 0,
        `${(row.rate * 100).toFixed(1)}%`,
      ]) {
        tr.createEl("td", { text: String(value) });
      }
    }
  }

  private async runFeedUpdate(feedIds?: number[]): Promise<void> {
    const notice = new Notice(t("ui.updating_feeds"), 0);
    try {
      const update = this.plugin.feedService.updateFeeds(feedIds, {
        onProgress: ({ completed, total, feedName }) => {
          notice.setMessage(t("ui.updating_feeds_current_total_feed", {
            current: completed,
            total,
            feed: feedName,
          }));
        },
      });
      await this.refresh();
      const results = await update;
      notice.setMessage(t("feed.update_done", {
        newItems: results.reduce(
          (sum, result) => sum + result.newItems,
          0,
        ),
        failed: results.filter((result) => result.error).length,
      }));
    } catch (error) {
      notice.setMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.viewWindow()?.setTimeout(() => notice.hide(), 5000);
      await this.refresh();
    }
  }

  private async undoLastAction(): Promise<void> {
    if (!this.lastAction) {
      return;
    }
    await this.plugin.repository.setItemStatus(
      this.lastAction.itemIds,
      this.lastAction.fromStatus,
    );
    new Notice(t("action.undone", { label: this.lastAction.label }));
    this.lastAction = null;
    await this.refresh();
  }

  private actionButton(
    container: HTMLElement,
    label: string,
    icon: string,
    action: () => void | Promise<void>,
    disabled = false,
  ): HTMLButtonElement {
    const button = container.createEl("button");
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.disabled = disabled;
    button.addEventListener("click", () => {
      runUiAction(action, button);
    });
    return button;
  }

  private viewWindow(): Window | null {
    return this.containerEl.ownerDocument.defaultView;
  }

  private async yieldToView(): Promise<void> {
    const viewWindow = this.viewWindow();
    if (!viewWindow) {
      return;
    }
    await new Promise<void>((resolve) => {
      viewWindow.setTimeout(resolve, 0);
    });
  }
}

function confirmGoogleTranslation(app: RssReaderPlugin["app"]): Promise<boolean> {
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
      text: t("ui.when_enabled_titles_in_the_current_viewport_and_prefetched_titles_are_se"),
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

class FeedModal extends Modal {
  constructor(
    private readonly plugin: RssReaderPlugin,
    private readonly feed: Feed | null,
    private readonly onSaved: () => void | Promise<void>,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle(this.feed ? t("ui.edit_feed") : t("ui.add_feed"));
    let name = this.feed?.name ?? "";
    let url = this.feed?.url ?? "";
    let enabled = this.feed?.enabled ?? true;
    new Setting(this.contentEl)
      .setName(t("ui.feed_name"))
      .addText((text) =>
        text.setValue(name).onChange((value) => {
          name = value;
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
            const input = { name, url, enabled };
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

class FeedImportModal extends Modal {
  constructor(
    private readonly plugin: RssReaderPlugin,
    private readonly onSaved: () => void | Promise<void>,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle(t("ui.bulk_import_feeds"));
    this.contentEl.createEl("p", {
      text: t("ui.supports_opml_xml_txt_pasted_content_or_one_url_per_line_duplicate_urls_"),
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
    textarea.addEventListener("change", () => {
      runUiAction(updatePreview, undefined, showPreviewError);
    });
    file.addEventListener("change", () => {
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
                skipped: result.skipped,
                failed: result.errors.length,
              }));
              this.close();
              await this.onSaved();
            }, button.buttonEl, showPreviewError);
          }),
      );
  }
}

class KeywordModal extends Modal {
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

class ConfirmModal extends Modal {
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

function transitionsFor(
  status: ItemStatus,
): Array<[string, ItemStatus]> {
  switch (status) {
    case "unread":
      return [
        [t("ui.interested"), "interested"],
        [t("ui.hide"), "hidden"],
      ];
    case "interested":
      return [
        [t("ui.archived"), "archived"],
        [t("ui.restore_to_unread"), "unread"],
        [t("ui.hide"), "hidden"],
      ];
    case "archived":
      return [
        [t("ui.restore_to_interested"), "interested"],
        [t("ui.hide"), "hidden"],
      ];
    case "hidden":
    case "expired":
      return [[t("ui.restore_to_unread"), "unread"]];
  }
}

function statusIcon(status: ItemStatus): string {
  return {
    unread: "inbox",
    interested: "star",
    archived: "archive",
    hidden: "eye-off",
    expired: "history",
  }[status];
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function primitiveText(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function recommendationExplanation(value: string): {
  positive: string[];
  negative: string[];
  context: string[];
} {
  const parsed = safeJson(value);
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  const terms = (key: string): string[] =>
    Array.isArray(record[key])
      ? record[key]
          .filter(
            (entry): entry is { keyword: string } =>
              Boolean(
                entry &&
                typeof entry === "object" &&
                "keyword" in entry &&
                typeof (entry as { keyword?: unknown }).keyword ===
                  "string",
              ),
          )
          .map((entry) => entry.keyword)
      : [];
  const positive = terms("positive");
  const negative = terms("negative");
  const context = [...positive, ...negative].filter((term) =>
    /^(?:author|journal|feed|freshness):/.test(term),
  );
  return {
    positive: positive.filter((term) => !context.includes(term)).slice(0, 3),
    negative: negative.filter((term) => !context.includes(term)).slice(0, 3),
    context: context.slice(0, 3),
  };
}

function runUiAction(
  action: () => void | Promise<void>,
  button?: HTMLButtonElement,
  onError?: (error: unknown) => void,
): void {
  executeUiAction(action, button, (error: unknown) => {
      if (onError) {
        onError(error);
      } else {
        new Notice(errorMessage(error), 10_000);
      }
    });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
