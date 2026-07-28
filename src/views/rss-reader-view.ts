import { ItemView, WorkspaceLeaf } from "obsidian";

import { RSS_READER_VIEW_TYPE } from "../constants";

export class RssReaderView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return RSS_READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "RSS reader";
  }

  getIcon(): string {
    return "rss";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    if (!(container instanceof HTMLElement)) {
      return;
    }

    container.empty();
    container.addClass("rss-reader");

    container.createEl("h2", { text: "RSS reader" });
    container.createEl("p", {
      cls: "rss-reader__intro",
      text: "插件基础框架已就绪。订阅管理、未读篮子和个性化推荐将在后续迁移阶段接入。",
    });

    const emptyState = container.createDiv({ cls: "rss-reader__empty-state" });
    emptyState.createDiv({ cls: "rss-reader__empty-icon", text: "◉" });
    emptyState.createEl("h3", { text: "还没有订阅源" });
    emptyState.createEl("p", {
      text: "后续版本会在这里展示订阅内容和阅读状态。",
    });
  }

  async onClose(): Promise<void> {
    // Obsidian owns the view container lifecycle.
  }
}
