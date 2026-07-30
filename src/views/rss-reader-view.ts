import {
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
import { t, tx } from "../i18n";
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
      ["reader", t("文献阅读"), "library-big"],
      ["feeds", t("订阅管理"), "list-plus"],
      ["analytics", t("兴趣分析"), "chart-column"],
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
    setup.createEl("h2", { text: t("需要配置数据目录") });
    const message =
      this.plugin.databaseState === "initializing"
        ? t("正在载入 Academic RSS Reader 数据库……")
        : this.plugin.databaseError
          ? tx(
              `数据库未载入：${this.plugin.databaseError}`,
              `Database not loaded: ${this.plugin.databaseError}`,
            )
          : t("Academic RSS Reader 不会在插件目录创建数据库。请先到设置中选择当前 Vault 内的数据目录，然后创建或载入数据库。");
    setup.createEl("p", { text: message });
    if (this.plugin.databaseState !== "initializing") {
      const button = setup.createEl("button", {
        cls: "mod-cta",
        text: t("打开 academic RSS reader 设置"),
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
    this.actionButton(actions, t("刷新"), "refresh-cw", () => this.refresh());
    this.actionButton(
      actions,
      t("撤回"),
      "undo-2",
      async () => this.undoLastAction(),
      !this.lastAction,
    );
    const translateButton = this.actionButton(
      actions,
      this.translationEnabled ? t("显示原文") : t("翻译标题"),
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
        text: t("这个篮子里当前没有文献。"),
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
    const actions = card.createDiv({ cls: "rss-reader__item-actions" });
    this.renderStatusActions(actions, item);
    if (item.link) {
      this.actionButton(actions, t("打开原文"), "external-link", () => {
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
          ? t("已加载全部文献")
          : t("继续向下滚动以加载更多"),
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
    this.readerSentinel.setText(t("正在加载更多文献……"));
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
        this.readerSentinel.setText(t("已加载全部文献"));
      } else {
        this.readerSentinel.setText(t("继续向下滚动以加载更多"));
      }
    } finally {
      this.loadingMore = false;
      this.readerSentinel?.removeAttribute("aria-busy");
    }
  }

  private readerCaptionText(): string {
    return tx(
      `当前篮子共有 ${this.readerMatched} 条，页面显示 ${this.readerItems.length} 条。`,
      `${this.readerMatched} papers in this basket; ${this.readerItems.length} shown.`,
    );
  }

  private renderTitle(container: HTMLElement, item: RssItem): void {
    container.createEl("h3", {
      text:
        this.translationEnabled && item.translatedTitle
          ? item.translatedTitle
          : item.title,
    });
    this.renderKeywordRelevance(container, item);
    if (
      this.translationEnabled &&
      item.titleTranslationStatus === "failed"
    ) {
      container.createSpan({
        cls: "rss-reader__translation-status is-error",
        text: t("翻译失败"),
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
        text: t("等待翻译……"),
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
        text: t("正在翻译……"),
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
    const tier =
      item.keywordScore >= 70
        ? "high"
        : item.keywordScore <= 30
          ? "low"
          : "pending";
    const label =
      tier === "high"
        ? t("高相关")
        : tier === "low"
          ? t("低相关")
          : t("待判断");
    container.createSpan({
      cls: `rss-reader__keyword-relevance is-${tier}`,
      text: label,
      attr: {
        "aria-label": tx(
          `关键词相关度：${label}`,
          `Keyword relevance: ${label}`,
        ),
      },
    });
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
    panel.createEl("summary", { text: t("个性化推荐") });
    const summary = this.plugin.repository.getRecommendationSummary();
    const metrics = panel.createDiv({ cls: "rss-reader__metrics" });
    for (const [label, value] of [
      [t("高相关"), summary.high],
      [t("待判断"), summary.pending],
      [t("低相关"), summary.low],
      [t("未评分"), summary.unscored],
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
        text: tx(
          `正样本 ${summary.positiveCount} · 负样本 ${summary.negativeCount} · 建模时未读 ${summary.unreadCount} · ${summary.createdAt ?? ""}`,
          `Positive ${summary.positiveCount} · Negative ${summary.negativeCount} · Unread at training ${summary.unreadCount} · ${summary.createdAt ?? ""}`,
        ),
      });
    }
    const actions = panel.createDiv({ cls: "rss-reader__item-actions" });
    this.actionButton(actions, t("更新关键词推荐"), "sparkles", async () => {
      const notice = new Notice(t("正在准备更新关键词推荐……"), 0);
      try {
        await this.yieldToView();
        const result = await this.plugin.recommendationService.rebuild(
          (message) => notice.setMessage(message),
        );
        notice.setMessage(
          tx(
            `推荐已更新：高 ${result.highCount}，待判断 ${result.pendingCount}，低 ${result.lowCount}`,
            `Recommendations updated: ${result.highCount} high, ${result.pendingCount} pending, ${result.lowCount} low.`,
          ),
        );
      } catch (error) {
        notice.setMessage(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        this.viewWindow()?.setTimeout(() => notice.hide(), 5000);
        await this.refresh();
      }
    });
    this.actionButton(actions, t("LLM 复核待判断"), "bot", async () => {
      const notice = new Notice(t("正在复核待判断论文……"), 0);
      try {
        const result = await this.plugin.llmService.reviewPending();
        notice.setMessage(
          tx(
            `复核完成：高 ${result.high}，低 ${result.low}，失败 ${result.failed}`,
            `Review completed: ${result.high} high, ${result.low} low, ${result.failed} failed.`,
          ),
        );
      } catch (error) {
        notice.setMessage(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        this.viewWindow()?.setTimeout(() => notice.hide(), 5000);
        await this.refresh();
      }
    });
    this.actionButton(actions, t("关键词词表"), "list-tree", () => {
      new KeywordModal(this.plugin).open();
    });
    const lowIds = this.plugin.repository.listLowRecommendationIds("", []);
    this.actionButton(
      actions,
      tx(
        `隐藏低相关（${lowIds.length}）`,
        `Hide low relevance (${lowIds.length})`,
      ),
      "eye-off",
      () => {
        new ConfirmModal(
          this.app,
          tx(
            `确认隐藏当前未读篮子中的 ${lowIds.length} 条低相关论文？`,
            `Hide ${lowIds.length} low-relevance papers from the current unread basket?`,
          ),
          async () => {
            const changed = await this.plugin.repository.setItemStatus(
              lowIds,
              "hidden",
            );
            this.lastAction = {
              itemIds: lowIds,
              fromStatus: "unread",
              label: tx(
                `${changed} 条低相关论文`,
                `${changed} low-relevance papers`,
              ),
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
    this.actionButton(actions, t("添加订阅"), "plus", () => {
      new FeedModal(this.plugin, null, () => this.refresh()).open();
    });
    this.actionButton(actions, t("批量导入"), "file-up", () => {
      new FeedImportModal(this.plugin, () => this.refresh()).open();
    });
    this.actionButton(actions, t("更新全部启用"), "refresh-cw", async () => {
      await this.runFeedUpdate();
    });

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
        text: tx(
          `最后更新：${primitiveText(summary.finishedAt, "")} · 成功 ${primitiveText(summary.successFeeds, "0")}/${primitiveText(summary.totalFeeds, "0")} · 新增 ${primitiveText(summary.totalNewItems, "0")} · 过期整理 ${primitiveText(summary.expiredItems, "0")}`,
          `Last update: ${primitiveText(summary.finishedAt, "")} · Successful ${primitiveText(summary.successFeeds, "0")}/${primitiveText(summary.totalFeeds, "0")} · New ${primitiveText(summary.totalNewItems, "0")} · Expired ${primitiveText(summary.expiredItems, "0")}`,
        ),
      });
    }

    const feeds = this.plugin.repository.listFeeds(true);
    if (feeds.length === 0) {
      container.createDiv({
        cls: "rss-reader__empty-state",
        text: t("还没有订阅源。"),
      });
      return;
    }
    const table = container.createEl("table", {
      cls: "rss-reader__table",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const label of [t("名称"), t("启用"), t("条目"), t("最后检查"), t("错误"), t("操作")]) {
      header.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const feed of feeds) {
      const row = body.createEl("tr");
      row.createEl("td", { text: feed.name });
      const enabledCell = row.createEl("td");
      new ToggleComponent(enabledCell)
        .setValue(feed.enabled)
        .setTooltip(feed.enabled ? t("停用订阅") : t("启用订阅"))
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
      row.createEl("td", { text: feed.lastCheckedAt ?? t("尚未更新") });
      row.createEl("td", { text: feed.lastError ?? "" });
      const rowActions = row.createEl("td", {
        cls: "rss-reader__table-actions",
      });
      this.actionButton(rowActions, t("编辑"), "pencil", () => {
        new FeedModal(this.plugin, feed, () => this.refresh()).open();
      });
      this.actionButton(rowActions, t("更新"), "refresh-cw", async () => {
        await this.runFeedUpdate([feed.id]);
      });
      this.actionButton(rowActions, t("删除"), "trash-2", () => {
        new ConfirmModal(
          this.app,
          tx(
            `删除订阅“${feed.name}”？仅属于它的文献也会删除，共享文献会保留。`,
            `Delete the feed “${feed.name}”? Papers unique to it will also be deleted; shared papers will be kept.`,
          ),
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
      [t("总条目"), counts.total],
      [t("未读"), counts.unread],
      [t("隐藏"), counts.hidden],
      [t("感兴趣"), counts.interested],
      [t("归档"), counts.archived],
      [t("过期"), counts.expired],
    ]) {
      const metric = metrics.createDiv({ cls: "rss-reader__metric" });
      metric.createSpan({ text: String(label) });
      metric.createEl("strong", { text: String(value ?? 0) });
    }
    container.createEl("p", {
      cls: "rss-reader__caption",
      text: tx(
        `隐藏文献在订阅更新后按 last_seen_at 整理，当前阈值 ${this.plugin.settings.hiddenExpireDays} 天。`,
        `Hidden papers are expired by last_seen_at after feed updates. Current threshold: ${this.plugin.settings.hiddenExpireDays} days.`,
      ),
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
      cls: "rss-reader__table",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const label of [
      t("期刊"),
      t("启用"),
      t("总条目"),
      t("未读"),
      t("隐藏"),
      t("感兴趣"),
      t("归档"),
      t("过期"),
      t("感兴趣率"),
    ]) {
      header.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const row of rows) {
      const tr = body.createEl("tr");
      for (const value of [
        row.name,
        row.enabled ? t("是") : t("否"),
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
    const notice = new Notice(t("正在更新订阅……"), 0);
    try {
      const results = await this.plugin.feedService.updateFeeds(feedIds);
      notice.setMessage(
        tx(
          `更新完成：新增 ${results.reduce((sum, result) => sum + result.newItems, 0)}，失败 ${results.filter((result) => result.error).length}`,
          `Update completed: ${results.reduce((sum, result) => sum + result.newItems, 0)} new items, ${results.filter((result) => result.error).length} failed feeds.`,
        ),
      );
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
    new Notice(
      tx(
        `已撤回：${this.lastAction.label}`,
        `Undone: ${this.lastAction.label}`,
      ),
    );
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
    this.setTitle(t("启用实验性标题翻译？"));
    this.contentEl.createEl("p", {
      text: t("启用后，当前视口中的文献标题及后续预取标题会直接发送给 Google 非正式网页翻译接口。请求不经过开发者服务器；该接口可能限流、失效，译文不应用于正式引用。"),
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("取消")).onClick(() => this.finish(false)),
      )
      .addButton((button) =>
        button
          .setButtonText(t("同意并启用"))
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
    this.setTitle(this.feed ? t("编辑订阅") : t("添加订阅"));
    let name = this.feed?.name ?? "";
    let url = this.feed?.url ?? "";
    let enabled = this.feed?.enabled ?? true;
    new Setting(this.contentEl)
      .setName(t("订阅名称"))
      .addText((text) =>
        text.setValue(name).onChange((value) => {
          name = value;
        }),
      );
    new Setting(this.contentEl)
      .setName("RSS URL")
      .addText((text) =>
        text.setValue(url).onChange((value) => {
          url = value;
        }),
      );
    new Setting(this.contentEl).setName(t("启用")).addToggle((toggle) =>
      toggle.setValue(enabled).onChange((value) => {
        enabled = value;
      }),
    );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(t("保存"))
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
    this.setTitle(t("批量导入订阅"));
    this.contentEl.createEl("p", {
      text: t("支持 opml、XML、txt、粘贴内容或逐行 URL。重复 URL 会跳过。"),
    });
    const file = this.contentEl.createEl("input", {
      type: "file",
      attr: { accept: ".opml,.xml,.txt,.rtf" },
    });
    const textarea = this.contentEl.createEl("textarea", {
      cls: "rss-reader__import-text",
      attr: { placeholder: t("粘贴 opml 或 RSS URL") },
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
      preview.setText(
        tx(
          `识别到 ${candidates.length} 个候选订阅`,
          `${candidates.length} feed candidates found.`,
        ),
      );
    };
    const showPreviewError = (error: unknown): void => {
      preview.setText(
        tx(
          `预览失败：${errorMessage(error)}`,
          `Preview failed: ${errorMessage(error)}`,
        ),
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
        button.setButtonText(t("预览")).onClick(() => {
          runUiAction(
            updatePreview,
            button.buttonEl,
            showPreviewError,
          );
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(t("导入"))
          .setCta()
          .onClick(() => {
            runUiAction(async () => {
              await updatePreview();
              const result =
                await this.plugin.feedService.importFeeds(candidates);
              new Notice(
                tx(
                  `新增 ${result.added}，跳过 ${result.skipped}，失败 ${result.errors.length}`,
                  `Added ${result.added}, skipped ${result.skipped}, failed ${result.errors.length}.`,
                ),
              );
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
    this.setTitle(t("推荐关键词词表"));
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    const keywords = this.plugin.repository.listKeywords(100);
    const table = this.contentEl.createEl("table", {
      cls: "rss-reader__table",
    });
    const header = table.createEl("thead").createEl("tr");
    for (const label of [t("关键词"), t("方向"), t("权重"), t("正样本"), t("负样本"), t("状态")]) {
      header.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const keyword of keywords) {
      const row = body.createEl("tr");
      for (const value of [
        keyword.keyword,
        keyword.effectiveWeight >= 0 ? t("正向") : t("负向"),
        keyword.effectiveWeight.toFixed(3),
        keyword.positiveCount,
        keyword.negativeCount,
        keyword.isDisabled
          ? t("已禁用")
          : keyword.manualWeight !== null
            ? t("人工")
            : t("自动"),
      ]) {
        row.createEl("td", { text: String(value) });
      }
    }
    let keyword = "";
    let direction: "positive" | "negative" = "positive";
    let weight = 1;
    let disabled = false;
    new Setting(this.contentEl)
      .setName(t("关键词"))
      .addText((text) =>
        text.onChange((value) => {
          keyword = value.trim().toLocaleLowerCase();
        }),
      );
    new Setting(this.contentEl)
      .setName(t("人工方向"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("positive", t("正向"))
          .addOption("negative", t("负向"))
          .onChange((value) => {
            direction = value as "positive" | "negative";
          }),
      );
    new Setting(this.contentEl)
      .setName(t("人工权重"))
      .addText((text) =>
        text.setValue("1").onChange((value) => {
          weight = Math.max(0.1, Math.min(5, Number(value) || 1));
        }),
      );
    new Setting(this.contentEl)
      .setName(t("禁用"))
      .addToggle((toggle) =>
        toggle.onChange((value) => {
          disabled = value;
        }),
      );
    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText(t("保存修正"))
          .setCta()
          .onClick(() => {
            runUiAction(async () => {
              if (!keyword) {
                new Notice(t("请输入关键词"));
                return;
              }
              await this.plugin.repository.saveKeywordOverride(
                keyword,
                direction,
                weight,
                disabled,
              );
              this.render();
            }, button.buttonEl);
          }),
      )
      .addButton((button) =>
        button.setButtonText(t("恢复自动权重")).onClick(() => {
          runUiAction(async () => {
            if (!keyword) {
              new Notice(t("请输入关键词"));
              return;
            }
            await this.plugin.repository.resetKeywordOverride(keyword);
            this.render();
          }, button.buttonEl);
        }),
      );
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
    this.setTitle(t("请确认"));
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("取消")).onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText(t("确认"))
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
        [t("感兴趣"), "interested"],
        [t("隐藏"), "hidden"],
      ];
    case "interested":
      return [
        [t("归档"), "archived"],
        [t("恢复未读"), "unread"],
        [t("隐藏"), "hidden"],
      ];
    case "archived":
      return [
        [t("恢复兴趣"), "interested"],
        [t("隐藏"), "hidden"],
      ];
    case "hidden":
    case "expired":
      return [[t("恢复未读"), "unread"]];
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
