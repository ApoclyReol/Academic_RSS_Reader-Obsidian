export type ScrollContainer = Pick<HTMLElement, "scrollTop">;

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
