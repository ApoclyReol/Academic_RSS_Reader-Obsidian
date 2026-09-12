import {
  ButtonComponent,
  ItemView,
  Modal,
  Notice,
  Setting,
  ToggleComponent,
  WorkspaceLeaf,
  finishRenderMath,
  loadMathJax,
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
  type ItemSort,
  type ItemStatus,
  type RssItem,
  type TranslationStatus,
} from "../models/domain";
import { statusLabel } from "./status-label";
import { executeUiAction } from "./ui-action";
import { recommendationExplanation } from "./recommendation-explanation";
import { renderItemImage } from "./item-image";
import {
  captureScrollTop,
  isScrollAtBottom,
  restoreScrollTop,
  scrollToTop,
} from "./scroll-position";
import {
  renderCardLabeledField,
  renderCardMetadata,
} from "./card-fields";
import {
  buildCardPresentation,
  cardLayoutOptions,
} from "./card-presentation";
import {
  renderMixedMathTitle,
  titleContainsMath,
} from "./mixed-math-title";

type Page = "reader" | "feeds" | "analytics";

interface LastAction {
  itemIds: number[];
  fromStatus: ItemStatus;
  label: string;
}

interface RefreshOptions {
  preserveScrollTop?: number;
  preserveSearchFocus?: boolean;
  resetScrollTop?: boolean;
}

interface RecommendationModalCallbacks {
  onChanged: () => void | Promise<void>;
  onLowRecommendationsHidden: (
    itemIds: number[],
    changed: number,
  ) => void | Promise<void>;
}

const READER_BATCH_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

export class RssReaderView extends ItemView {
  private page: Page = "reader";
  private status: ItemStatus = "unread";
  private itemSort: ItemSort = "relevance";
  private lastAction: LastAction | null = null;
  private translationEnabled = false;
  private titleObserver: IntersectionObserver | null = null;
  private loadMoreObserver: IntersectionObserver | null = null;
  private mathFlushScheduled = false;
  private mathJaxLoading: Promise<void> | null = null;
  private mathJaxReady = false;
  private viewActive = false;
  private requestedTitleIds = new Set<string>();
  private readerQuery = "";
  private feedQuery = "";
  private analyticsQuery = "";
  private readerItems: RssItem[] = [];
  private readerMatched = 0;
  private readerList: HTMLElement | null = null;
  private readerCaption: HTMLElement | null = null;
  private readerSentinel: HTMLElement | null = null;
  private readerBackToTopButton: HTMLButtonElement | null = null;
  private readerBackToTopActions: HTMLElement | null = null;
  private readerModeActions: HTMLElement | null = null;
  private readerSearchInput: HTMLInputElement | null = null;
  private feedSearchInput: HTMLInputElement | null = null;
  private analyticsSearchInput: HTMLInputElement | null = null;
  private searchComposingInput: HTMLInputElement | null = null;
  private readerScrollListenerContainer: HTMLElement | null = null;
  private backToTopAnimation: Animation | null = null;
  private searchRefreshTimer: number | null = null;
  private translationRetryButton: HTMLButtonElement | null = null;
  private loadingMore = false;
  private rendering = false;
  private renderAgain = false;
  private pendingScrollTop: number | undefined;

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
    this.viewActive = true;
    this.plugin.prepareDatabaseOnViewOpen();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.viewActive = false;
    this.titleObserver?.disconnect();
    this.loadMoreObserver?.disconnect();
    this.clearSearchRefreshTimer();
    this.backToTopAnimation?.cancel();
    this.backToTopAnimation = null;
    this.readerBackToTopButton = null;
    this.readerBackToTopActions = null;
    this.readerSearchInput = null;
    this.feedSearchInput = null;
    this.analyticsSearchInput = null;
    this.searchComposingInput = null;
  }

  async refresh(options: RefreshOptions = {}): Promise<void> {
    if (options.preserveScrollTop !== undefined) {
      this.pendingScrollTop = options.preserveScrollTop;
    }
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    const preserveScrollTop = this.pendingScrollTop;
    this.pendingScrollTop = undefined;
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
      this.readerBackToTopButton = null;
      this.readerBackToTopActions = null;
      this.readerSearchInput = null;
      this.feedSearchInput = null;
      this.analyticsSearchInput = null;
      this.searchComposingInput = null;
      this.backToTopAnimation?.cancel();
      this.backToTopAnimation = null;
      this.readerModeActions = null;
      this.translationRetryButton = null;
      this.loadingMore = false;
      const container = this.containerEl.children[1];
      if (!container?.instanceOf(HTMLElement)) {
        return;
      }
      container.empty();
      container.addClass("rss-reader");
      this.registerReaderScrollListener(container);
      const cardLayout = cardLayoutOptions(this.plugin.settings);
      container.toggleClass(
        "rss-reader--card-metadata",
        cardLayout.showMetadata,
      );
      container.toggleClass(
        "rss-reader--card-authors",
        cardLayout.showAuthors,
      );
      container.toggleClass(
        "rss-reader--card-abstract",
        cardLayout.showAbstract,
      );
      container.toggleClass(
        "rss-reader--card-compact",
        cardLayout.showMetadata &&
          cardLayout.showAuthors &&
          cardLayout.showAbstract,
      );
      if (!this.plugin.isDatabaseReady()) {
        this.renderDatabaseSetup(container);
        this.restoreRefreshState(container, options, preserveScrollTop);
        return;
      }
      const stickyNavigation = container.createDiv({
        cls: "rss-reader__sticky-navigation",
      });
      this.renderHeader(stickyNavigation);
      if (this.page === "reader") {
        this.renderReader(container, stickyNavigation);
      } else if (this.page === "feeds") {
        this.renderFeeds(container);
      } else {
        this.renderAnalytics(container);
      }
      this.restoreRefreshState(container, options, preserveScrollTop);
    } finally {
      this.rendering = false;
      if (this.renderAgain) {
        this.renderAgain = false;
        await this.refresh();
      }
    }
  }

  refreshTranslatedTitle(
    itemId: number,
    field: "title" | "abstract",
    targetLanguage: string,
    status?: TranslationStatus,
  ): void {
    if (status === "succeeded" || status === "failed") {
      this.requestedTitleIds.delete(
        translationRequestKey(itemId, field, targetLanguage),
      );
    }
    if (field !== "title") {
      return;
    }
    this.updateTranslationRetryAction();
    if (!this.plugin.isDatabaseReady()) {
      return;
    }
    const card = this.containerEl.querySelector(
      `.rss-reader__item[data-item-id="${itemId}"]`,
    );
    const item = this.plugin.repository.getItem(itemId, targetLanguage);
    if (!item) {
      return;
    }
    if (targetLanguage === this.plugin.settings.targetLanguage) {
      const itemIndex = this.readerItems.findIndex(
        (readerItem) => readerItem.id === itemId,
      );
      if (itemIndex >= 0) {
        this.readerItems[itemIndex] = item;
      }
    }
    if (!card?.instanceOf(HTMLElement)) {
      return;
    }
    const title = card.querySelector(".rss-reader__item-title");
    if (title?.instanceOf(HTMLElement)) {
      title.empty();
      this.renderTitle(title, item);
    }
    this.updateTranslationRetryAction();
  }

  refreshTranslatedTitles(): void {
    for (const item of this.readerItems) {
      this.refreshTranslatedTitle(
        item.id,
        "title",
        this.plugin.settings.targetLanguage,
      );
    }
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "rss-reader__header" });
    const title = header.createDiv({ cls: "rss-reader__brand" });
    setIcon(title.createSpan(), "rss");
    title.createEl("h2", { text: t("ui.app_name") });

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
        this.clearSearchRefreshTimer();
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

  private renderReader(
    container: HTMLElement,
    navigationContainer = container,
  ): void {
    const counts = this.plugin.repository.countByStatus();
    const controls = navigationContainer.createDiv({
      cls: "rss-reader__reader-controls",
    });
    this.renderSearch(controls);
    const baskets = controls.createDiv({
      cls: "rss-reader__baskets",
    });
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
        this.clearSearchRefreshTimer();
        this.status = status;
        runUiAction(() => this.refresh(), button);
      });
    }

    const query = {
      status: this.status,
      sort: this.itemSort,
      query: this.readerQuery,
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
    this.readerModeActions = actions;
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
    this.updateTranslationRetryAction();
    this.renderSortActions(actions);

    const statusActions = actions.createDiv({
      cls: "rss-reader__control-group rss-reader__status-actions",
      attr: {
        role: "group",
        "aria-label": t("ui.actions"),
      },
    });
    this.actionButton(
      statusActions,
      t("ui.undo"),
      "undo-2",
      async () => this.undoLastAction(),
      !this.lastAction,
    );
    if (this.status === "unread") {
      this.actionButton(
        statusActions,
        t("reader.hide_remaining_unread", {
          count: counts.unread,
        }),
        "eye-off",
        () => {
          new ConfirmModal(
            this.app,
            t("reader.hide_remaining_unread_confirm", {
              count: counts.unread,
            }),
            async () => {
              const itemIds = await this.plugin.repository.moveAllItems(
                "unread",
                "hidden",
              );
              if (itemIds.length > 0) {
                this.lastAction = {
                  itemIds,
                  fromStatus: "unread",
                  label: t("reader.remaining_unread_papers", {
                    count: itemIds.length,
                  }),
                };
              }
              await this.refresh();
            },
          ).open();
        },
        counts.unread === 0,
      );
    }
    if (this.status === "unread") {
      const recommendationButton = this.actionButton(
        actions,
        t("ui.personalized_recommendations"),
        "sparkles",
        () => this.openRecommendationModal(),
      );
      recommendationButton.setAttribute("aria-haspopup", "dialog");
    }

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
    this.renderBackToTopAction(container);
  }

  private renderSearch(container: HTMLElement): void {
    this.renderPageSearch(
      container,
      "reader",
      this.readerQuery,
      t("reader.search_papers"),
    );
  }

  private renderPageSearch(
    container: HTMLElement,
    page: Page,
    value: string,
    ariaLabel: string,
  ): void {
    const search = container.createDiv({
      cls:
        page === "reader"
          ? "rss-reader__search"
          : "rss-reader__search rss-reader__search--page",
    });
    const input = search.createEl("input", {
      type: "search",
      placeholder: t("reader.search_placeholder"),
      attr: {
        "aria-label": ariaLabel,
      },
    });
    input.value = value;
    if (page === "reader") {
      this.readerSearchInput = input;
    } else if (page === "feeds") {
      this.feedSearchInput = input;
    } else {
      this.analyticsSearchInput = input;
    }
  }

  private renderItemCard(container: HTMLElement, item: RssItem): void {
    const layout = cardLayoutOptions(this.plugin.settings);
    const presentation = buildCardPresentation(item, this.plugin.settings);
    const card = container.createDiv({ cls: "rss-reader__item" });
    card.dataset.itemId = String(item.id);
    const content = card.createDiv({
      cls: "rss-reader__item-content",
    });
    const titleContainer = content.createDiv({
      cls: "rss-reader__item-title",
    });
    this.renderTitle(titleContainer, item);
    if (layout.showMetadata) {
      renderCardMetadata(content, presentation);
    }
    if (layout.showAuthors) {
      renderCardLabeledField(
        content,
        "rss-reader__item-authors",
        t("ui.authors"),
        presentation.authors,
      );
    }
    if (layout.showAbstract) {
      renderCardLabeledField(
        content,
        "rss-reader__item-abstract",
        t("ui.abstract"),
        presentation.abstract,
      );
    }
    const footer = content.createDiv({
      cls: "rss-reader__item-footer",
    });
    const actions = footer.createDiv({ cls: "rss-reader__item-actions" });
    this.renderStatusActions(actions, item);
    if (item.link) {
      this.actionButton(actions, t("ui.open_original"), "external-link", () => {
        if (/^https?:\/\//i.test(item.link)) {
          this.viewWindow()?.open(item.link, "_external");
        }
      });
    }
    this.renderKeywordRelevance(footer, item);
    renderItemImage(
      card,
      {
        imageUrl: presentation.imageUrl,
        title: item.title,
      },
      (target, type, callback) => {
        this.registerDomEvent(target, type, callback);
      },
      () => {
        new GraphicalAbstractModal(this.plugin, item).open();
      },
    );
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
      this.updateBackToTopPosition();
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

  private renderBackToTopAction(container: HTMLElement): void {
    if (
      this.readerBackToTopButton?.isConnected &&
      this.readerBackToTopActions?.isConnected
    ) {
      return;
    }
    const actions = container.createDiv({
      cls: "rss-reader__end-actions",
    });
    const layer = actions.createDiv({
      cls: "rss-reader__back-to-top-layer",
    });
    this.readerBackToTopActions = actions;
    this.readerBackToTopButton = this.actionButton(
      layer,
      t("ui.back_to_top"),
      "arrow-up",
      () => {
        scrollToTop(this.readerScrollContainer());
        this.updateBackToTopPosition();
      },
    );
    this.readerBackToTopButton.addClass("rss-reader__back-to-top");
    this.readerBackToTopButton.setAttribute(
      "aria-label",
      t("ui.back_to_top"),
    );
    this.updateBackToTopPosition(false);
  }

  private renderSortActions(container: HTMLElement): void {
    const group = container.createDiv({
      cls: "rss-reader__control-group rss-reader__sort-actions",
      attr: {
        role: "group",
        "aria-label": t("reader.sort_options"),
      },
    });
    for (const [sort, label, icon] of [
      ["title", t("reader.sort_by_title"), "arrow-down-a-z"],
      ["updated", t("reader.sort_by_update_time"), "clock-3"],
      ["journal", t("reader.sort_by_journal"), "book-open"],
      ["relevance", t("reader.sort_by_relevance"), "sparkles"],
    ] as Array<[ItemSort, string, string]>) {
      const active = this.itemSort === sort;
      const button = this.actionButton(group, label, icon, async () => {
        if (this.itemSort === sort) {
          return;
        }
        this.itemSort = sort;
        await this.refresh();
      });
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private openRecommendationModal(): void {
    new RecommendationModal(this.plugin, {
      onChanged: () => this.refresh(),
      onLowRecommendationsHidden: (itemIds, changed) => {
        this.lastAction = {
          itemIds,
          fromStatus: "unread",
          label: t("recommendation.low_papers", { count: changed }),
        };
        return this.refresh();
      },
    }).open();
  }

  private renderTitle(container: HTMLElement, item: RssItem): void {
    const title =
      this.translationEnabled && item.translatedTitle
        ? item.translatedTitle
        : item.title;
    const heading = container.createEl("h3", {
      attr: { title },
    });
    if (titleContainsMath(title) && !this.mathJaxReady) {
      heading.appendText(title);
      this.ensureMathJaxLoaded();
    } else if (renderMixedMathTitle(heading, title)) {
      this.scheduleMathFlush();
    }
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

  private ensureMathJaxLoaded(): void {
    if (this.mathJaxReady || this.mathJaxLoading) {
      return;
    }
    const loading = loadMathJax();
    this.mathJaxLoading = loading;
    void loading.then(
      () => {
        if (this.mathJaxLoading !== loading) {
          return;
        }
        this.mathJaxLoading = null;
        this.mathJaxReady = true;
        if (this.viewActive && this.plugin.isDatabaseReady()) {
          this.refreshTranslatedTitles();
        }
      },
      () => {
        if (this.mathJaxLoading === loading) {
          this.mathJaxLoading = null;
        }
      },
    );
  }

  private scheduleMathFlush(): void {
    if (this.mathFlushScheduled) {
      return;
    }
    const viewWindow = this.viewWindow();
    if (!viewWindow) {
      return;
    }
    this.mathFlushScheduled = true;
    viewWindow.queueMicrotask(() => {
      this.mathFlushScheduled = false;
      void finishRenderMath().catch(() => undefined);
    });
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
    const statusCell = relevance.createDiv({
      cls: "rss-reader__relevance-cell is-status",
      attr: {
        "aria-label": t("recommendation.aria", { label }),
      },
    });
    statusCell.createSpan({
      cls: `rss-reader__keyword-relevance is-${tier}`,
      text: label,
    });
    const explanation = recommendationExplanation(item.matchedKeywords);
    const positiveText = t("recommendation.positive_terms", {
      terms: explanation.positive.join(", "),
    });
    relevance.createDiv({
      cls: "rss-reader__relevance-cell is-positive",
      text: positiveText,
      attr: { title: positiveText },
    });
    const negativeText = t("recommendation.negative_terms", {
      terms: explanation.negative.join(", "),
    });
    relevance.createDiv({
      cls: "rss-reader__relevance-cell is-negative",
      text: negativeText,
      attr: { title: negativeText },
    });
  }

  private updateTranslationRetryAction(): void {
    const shouldShow =
      this.translationEnabled &&
      this.plugin.isDatabaseReady() &&
      this.plugin.translationService.hasFailed("title");
    if (!shouldShow) {
      this.translationRetryButton?.remove();
      this.translationRetryButton = null;
      return;
    }
    if (this.translationRetryButton?.isConnected || !this.readerModeActions) {
      return;
    }
    this.translationRetryButton = this.actionButton(
      this.readerModeActions,
      t("ui.retry_translation"),
      "rotate-ccw",
      async () => {
        const preserveScrollTop = this.readerScrollTop();
        await this.plugin.translationService.retryFailed("title");
        this.updateTranslationRetryAction();
        await this.refresh({ preserveScrollTop });
      },
    );
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
            item.titleTranslationStatus === "failed" ||
            this.requestedTitleIds.has(
              translationRequestKey(item.id, "title", this.plugin.settings.targetLanguage),
            )
          ) {
            continue;
          }
          const requestKey = translationRequestKey(
            item.id,
            "title",
            this.plugin.settings.targetLanguage,
          );
          this.requestedTitleIds.add(requestKey);
          runUiAction(
            () =>
              this.plugin.translationService
                .requestManual(item.id, "title")
                .then(() => undefined),
            undefined,
            (error) => {
              this.requestedTitleIds.delete(requestKey);
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
        const preserveScrollTop = this.readerScrollTop();
        this.lastAction = {
          itemIds: [item.id],
          fromStatus: item.itemStatus,
          label: item.title,
        };
        await this.plugin.repository.setItemStatus([item.id], status);
        await this.refresh({ preserveScrollTop });
      });
    }
  }

  private readerScrollTop(): number | undefined {
    return captureScrollTop(this.readerScrollContainer());
  }

  private readerScrollContainer(): HTMLElement | null {
    const container = this.containerEl.children[1];
    return container?.instanceOf(HTMLElement) ? container : null;
  }

  private registerReaderScrollListener(container: HTMLElement): void {
    if (this.readerScrollListenerContainer === container) {
      return;
    }
    this.readerScrollListenerContainer = container;
    this.registerDomEvent(container, "scroll", () => {
      this.updateBackToTopPosition();
    });
    this.registerDomEvent(container, "compositionstart", (event) => {
      const input = this.searchInputForTarget(event.target);
      if (!input) {
        return;
      }
      this.searchComposingInput = input;
      this.clearSearchRefreshTimer();
    });
    const finishSearchComposition = (event: CompositionEvent) => {
      const input = this.searchInputForTarget(event.target);
      if (!input) {
        return;
      }
      this.searchComposingInput = null;
      this.setSearchQuery(input, input.value);
      this.scheduleSearchRefresh();
    };
    this.registerDomEvent(container, "compositionend", finishSearchComposition);
    this.registerDomEvent(container, "input", (event) => {
      const input = this.searchInputForTarget(event.target);
      if (!input) {
        return;
      }
      this.setSearchQuery(input, input.value);
      const isComposing =
        "isComposing" in event && event.isComposing === true;
      if (this.searchComposingInput === input || isComposing) {
        return;
      }
      this.scheduleSearchRefresh();
    });
  }

  private searchInputForTarget(
    target: EventTarget | null,
  ): HTMLInputElement | null {
    for (const input of [
      this.readerSearchInput,
      this.feedSearchInput,
      this.analyticsSearchInput,
    ]) {
      if (input && target === input) {
        return input;
      }
    }
    return null;
  }

  private searchPageForInput(input: HTMLInputElement): Page | null {
    if (input === this.readerSearchInput) {
      return "reader";
    }
    if (input === this.feedSearchInput) {
      return "feeds";
    }
    if (input === this.analyticsSearchInput) {
      return "analytics";
    }
    return null;
  }

  private setSearchQuery(input: HTMLInputElement, value: string): void {
    const page = this.searchPageForInput(input);
    if (page === "reader") {
      this.readerQuery = value;
    } else if (page === "feeds") {
      this.feedQuery = value;
    } else if (page === "analytics") {
      this.analyticsQuery = value;
    }
  }

  private updateBackToTopPosition(animate = true): void {
    const actions = this.readerBackToTopActions;
    const layer = this.readerBackToTopButton?.parentElement;
    const container = this.readerScrollContainer();
    if (!actions || !layer || !container) {
      return;
    }
    const shouldFloat = !isScrollAtBottom(container);
    if (actions.hasClass("is-floating") === shouldFloat) {
      return;
    }
    const startRect = animate ? layer.getBoundingClientRect() : null;
    this.backToTopAnimation?.cancel();
    this.backToTopAnimation = null;
    actions.toggleClass("is-floating", shouldFloat);
    if (!startRect || !layer.isConnected) {
      return;
    }
    const endRect = layer.getBoundingClientRect();
    const viewWindow = layer.ownerDocument.defaultView;
    const prefersReducedMotion = viewWindow?.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches ?? false;
    const deltaX = startRect.left - endRect.left;
    const deltaY = startRect.top - endRect.top;
    if (
      prefersReducedMotion ||
      (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) ||
      typeof layer.animate !== "function"
    ) {
      return;
    }
    const animation = layer.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    this.backToTopAnimation = animation;
    animation.onfinish = () => {
      if (this.backToTopAnimation === animation) {
        this.backToTopAnimation = null;
      }
    };
    animation.oncancel = animation.onfinish;
  }

  private restoreRefreshState(
    container: HTMLElement,
    options: RefreshOptions,
    preserveScrollTop: number | undefined,
  ): void {
    if (options.resetScrollTop) {
      scrollToTop(container);
    } else {
      restoreScrollTop(container, preserveScrollTop);
    }
    if (options.preserveSearchFocus) {
      this.focusSearchInput();
    }
    this.updateBackToTopPosition(false);
  }

  private focusSearchInput(): void {
    const input = this.page === "reader"
      ? this.readerSearchInput
      : this.page === "feeds"
        ? this.feedSearchInput
        : this.analyticsSearchInput;
    if (!input?.isConnected) {
      return;
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  private scheduleSearchRefresh(): void {
    const viewWindow = this.viewWindow();
    if (!viewWindow) {
      return;
    }
    if (this.searchRefreshTimer !== null) {
      viewWindow.clearTimeout(this.searchRefreshTimer);
    }
    this.searchRefreshTimer = viewWindow.setTimeout(() => {
      this.searchRefreshTimer = null;
      runUiAction(() => this.refresh({
        preserveSearchFocus: true,
        resetScrollTop: true,
      }));
    }, SEARCH_DEBOUNCE_MS);
  }

  private clearSearchRefreshTimer(): void {
    const viewWindow = this.viewWindow();
    if (this.searchRefreshTimer !== null) {
      viewWindow?.clearTimeout(this.searchRefreshTimer);
      this.searchRefreshTimer = null;
    }
  }

  private renderFeeds(container: HTMLElement): void {
    this.renderPageSearch(
      container,
      "feeds",
      this.feedQuery,
      t("ui.search_subscriptions"),
    );
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

    const allFeeds = this.plugin.repository.listFeeds(true);
    const feeds = allFeeds.filter((feed) => matchesFuzzyQuery(
      this.feedQuery,
      [
        feed.name,
        feed.journalName,
        feed.displayJournalName,
        feed.url,
        feed.lastError,
      ],
    ));
    if (feeds.length === 0) {
      container.createDiv({
        cls: "rss-reader__empty-state",
        text: allFeeds.length === 0
          ? t("ui.no_feeds_yet")
          : t("ui.no_matching_results"),
      });
      return;
    }
    const tableShell = container.createDiv({
      cls: "rss-reader__table-shell",
    });
    const table = tableShell.createEl("table", {
      cls: "rss-reader__table rss-reader__table--feeds",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const [label, className] of [
      [t("ui.journal"), "is-text"],
      [t("ui.enabled"), "is-center"],
      [t("ui.items"), "is-number"],
      [t("feed.last_success"), "is-date"],
      [t("feed.health"), "is-center"],
      [t("feed.next_attempt"), "is-date"],
      [t("ui.error"), "is-error"],
      [t("ui.actions"), "is-actions"],
    ]) {
      header.createEl("th", { cls: className, text: label });
    }
    const body = table.createEl("tbody");
    for (const feed of feeds) {
      const row = body.createEl("tr");
      row.createEl("td", {
        cls: "is-text",
        text: feed.displayJournalName,
        attr: { title: feed.displayJournalName },
      });
      const enabledCell = row.createEl("td", { cls: "is-center" });
      new ToggleComponent(enabledCell)
        .setValue(feed.enabled)
        .setTooltip(feed.enabled ? t("ui.disable_feed") : t("ui.enable_feed"))
        .onChange((enabled) => {
          runUiAction(async () => {
            await this.plugin.feedService.updateFeed(feed.id, {
              name: feed.name,
              journalName: feed.journalName,
              url: feed.url,
              enabled,
            });
            await this.refresh();
          });
        });
      row.createEl("td", {
        cls: "is-number",
        text: String(feed.itemCount),
      });
      row.createEl("td", {
        cls: "is-date",
        text: feed.lastSuccessAt ? formatDate(feed.lastSuccessAt) : "—",
      });
      const healthCell = row.createEl("td", { cls: "is-center" });
      healthCell.createSpan({
        cls: `rss-reader__status-badge is-${feed.healthStatus}`,
        text: feed.healthStatus === "healthy"
          ? t("feed.health_healthy")
          : t(
              feed.healthStatus === "failing"
                ? "feed.health_failing"
                : "feed.health_degraded",
              { count: feed.consecutiveFailures },
            ),
      });
      row.createEl("td", {
        cls: "is-date",
        text: feed.nextAutoUpdateAt
          ? formatDate(feed.nextAutoUpdateAt)
          : "—",
      });
      row.createEl("td", {
        cls: "is-error",
        text: feed.lastError ?? "—",
        attr: { title: feed.lastError ?? "" },
      });
      const rowActions = row.createEl("td", {
        cls: "rss-reader__table-actions is-actions",
      });
      this.actionButton(rowActions, t("ui.edit"), "pencil", () => {
        new FeedModal(
          this.plugin,
          {
            ...feed,
            journalName: feed.displayJournalName,
          },
          () => this.refresh(),
        ).open();
      });
      this.actionButton(rowActions, t("ui.update"), "refresh-cw", async () => {
        await this.runFeedUpdate([feed.id]);
      });
      this.actionButton(rowActions, t("ui.delete"), "trash-2", () => {
        new ConfirmModal(
          this.app,
          t("feed.delete_confirm", { name: feed.displayJournalName }),
          async () => {
            await this.plugin.repository.deleteFeeds([feed.id]);
            await this.refresh();
          },
        ).open();
      });
    }
  }

  private renderAnalytics(container: HTMLElement): void {
    this.renderPageSearch(
      container,
      "analytics",
      this.analyticsQuery,
      t("ui.search_interest_analysis"),
    );
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
    const allRows: Array<Record<string, unknown> & { rate: number }> =
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
    const rows = allRows.filter((row) => matchesFuzzyQuery(
      this.analyticsQuery,
      [row.name, row.journal_name, row.inferred_journal, row.url],
    ));
    if (rows.length === 0) {
      container.createDiv({
        cls: "rss-reader__empty-state",
        text: t("ui.no_matching_results"),
      });
      return;
    }
    const tableShell = container.createDiv({
      cls: "rss-reader__table-shell",
    });
    const table = tableShell.createEl("table", {
      cls: "rss-reader__table rss-reader__table--analytics",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const [label, className] of [
      [t("ui.journal"), "is-text"],
      [t("ui.enabled"), "is-center"],
      [t("ui.total_items"), "is-number"],
      [t("ui.unread"), "is-number"],
      [t("ui.hide"), "is-number"],
      [t("ui.interested"), "is-number"],
      [t("ui.archived"), "is-number"],
      [t("ui.expired_2"), "is-number"],
      [t("ui.interest_rate"), "is-number"],
    ]) {
      header.createEl("th", { cls: className, text: label });
    }
    const body = table.createEl("tbody");
    for (const row of rows) {
      const tr = body.createEl("tr");
      tr.createEl("td", {
        cls: "is-text",
        text: String(row.name),
        attr: { title: String(row.name) },
      });
      tr.createEl("td", {
        cls: "is-center",
        text: row.enabled ? t("ui.yes") : t("ui.no"),
      });
      for (const value of [
        row.total_count ?? 0,
        row.unread_count ?? 0,
        row.hidden_count ?? 0,
        row.interested_count ?? 0,
        row.archived_count ?? 0,
        row.expired_count ?? 0,
      ]) {
        tr.createEl("td", {
          cls: "is-number",
          text: primitiveText(value, "0"),
        });
      }
      const rateCell = tr.createEl("td", { cls: "is-number" });
      rateCell.createSpan({
        cls: "rss-reader__rate-badge",
        text: `${(row.rate * 100).toFixed(1)}%`,
      });
    }
  }

  private async runFeedUpdate(feedIds?: number[]): Promise<void> {
    const notice = new Notice(t("ui.updating_feeds"), 0);
    let cancelled = false;
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
      cancelled = results.some((result) => result.cancelled);
      if (cancelled) {
        notice.setMessage(t("ui.feed_update_cancelled"));
        return;
      }
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
      if (!cancelled) {
        await this.refresh();
      }
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
}

class GraphicalAbstractModal extends Modal {
  constructor(
    private readonly plugin: RssReaderPlugin,
    private readonly item: Pick<RssItem, "imageUrl" | "title">,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
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
    this.plugin.registerDomEvent(image, "error", () => {
      frame.empty();
      frame.createEl("p", {
        cls: "rss-reader__warning",
        text: t("ui.graphical_abstract_failed_to_load"),
        attr: { role: "alert" },
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class RecommendationModal extends Modal {
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

function matchesFuzzyQuery(query: string, values: unknown[]): boolean {
  const terms = query.normalize("NFKC").toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) {
    return true;
  }
  const haystack = values
    .map((value) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint"
        ? String(value).normalize("NFKC").toLocaleLowerCase()
        : ""
    )
    .join(" ");
  return terms.every((term) => haystack.includes(term));
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

function translationRequestKey(
  itemId: number,
  field: "title" | "abstract",
  targetLanguage: string,
): string {
  return `${itemId}:${field}:${targetLanguage}`;
}
