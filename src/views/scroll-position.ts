export type ScrollContainer = Pick<HTMLElement, "scrollTop">;
export type MeasuredScrollContainer = ScrollContainer &
  Pick<HTMLElement, "clientHeight" | "scrollHeight">;

export function captureScrollTop(
  container: ScrollContainer | null | undefined,
): number | undefined {
  return container?.scrollTop;
}

export function restoreScrollTop(
  container: ScrollContainer,
  scrollTop: number | undefined,
): void {
  if (scrollTop === undefined) {
    return;
  }
  container.scrollTop = scrollTop;
}

export function scrollToTop(container: ScrollContainer | null | undefined): void {
  if (!container) {
    return;
  }
  container.scrollTop = 0;
}

export function isScrollAtBottom(
  container: MeasuredScrollContainer | null | undefined,
  threshold = 4,
): boolean {
  if (!container) {
    return false;
  }
  return container.scrollHeight <= container.clientHeight ||
    container.scrollTop + container.clientHeight >=
      container.scrollHeight - threshold;
}
