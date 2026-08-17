import { t } from "../i18n";
import type { RssItem } from "../models/domain";

type RegisterImageEvent = (
  target: HTMLElement,
  type: "click" | "error" | "keydown",
  callback: (event: Event) => void,
) => void;

function eventKey(event: Event): string {
  return "key" in event && typeof event.key === "string" ? event.key : "";
}

export function renderItemImage(
  container: HTMLElement,
  item: Pick<RssItem, "imageUrl" | "title">,
  registerDomEvent: RegisterImageEvent,
  openPreview: () => void,
): HTMLElement | null {
  if (!item.imageUrl) {
    return null;
  }
  container.addClass("rss-reader__item--has-image");
  const imageContainer = container.createDiv({
    cls: "rss-reader__item-image",
  });
  const image = imageContainer.createEl("img", {
    cls: "rss-reader__item-image-control",
    attr: {
      alt: t("ui.graphical_abstract_for", { title: item.title }),
      "aria-label": t("ui.enlarge_graphical_abstract_for", {
        title: item.title,
      }),
      role: "button",
      src: item.imageUrl,
      tabindex: "0",
    },
  });
  image.loading = "lazy";
  image.decoding = "async";
  registerDomEvent(image, "click", openPreview);
  registerDomEvent(image, "keydown", (event) => {
    const key = eventKey(event);
    if (key !== "Enter" && key !== " ") {
      return;
    }
    event.preventDefault();
    openPreview();
  });
  registerDomEvent(image, "error", () => {
    imageContainer.remove();
    container.removeClass("rss-reader__item--has-image");
  });
  return imageContainer;
}
