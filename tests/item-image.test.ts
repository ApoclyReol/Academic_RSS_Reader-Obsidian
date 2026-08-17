import { describe, expect, it, vi } from "vitest";

import { renderItemImage } from "../src/views/item-image";

describe("item image renderer", () => {
  it("renders a lazy image with localized alternative text and removes it on error", () => {
    const attributes: Record<string, string> = {};
    const image = {
      decoding: "",
      getAttribute: (name: string): string | null => attributes[name] ?? null,
      loading: "",
      setAttribute: (name: string, value: string): void => {
        attributes[name] = value;
      },
    } as unknown as HTMLImageElement;
    const removeImageContainer = vi.fn();
    const imageContainer = {
      createEl: vi.fn((
        _tag: string,
        options: { attr?: Record<string, string> },
      ) => {
        for (const [name, value] of Object.entries(options.attr ?? {})) {
          image.setAttribute(name, value);
        }
        return image;
      }),
      remove: removeImageContainer,
    } as unknown as HTMLElement;
    const addClass = vi.fn();
    const removeClass = vi.fn();
    const container = {
      addClass,
      createDiv: vi.fn(() => imageContainer),
      removeClass,
    } as unknown as HTMLElement;
    let onClick!: (event: Event) => void;
    let onError!: (event: Event) => void;
    let onKeydown!: (event: Event) => void;
    const openPreview = vi.fn();

    renderItemImage(
      container,
      {
        imageUrl: "https://cdn.example.com/figure.png",
        title: "A paper",
      },
      (target, type, callback) => {
        expect(target).toBe(image);
        if (type === "click") {
          onClick = callback;
        } else if (type === "keydown") {
          onKeydown = callback;
        } else {
          onError = callback;
        }
      },
      openPreview,
    );

    expect(addClass).toHaveBeenCalledWith("rss-reader__item--has-image");
    expect(image.getAttribute("role")).toBe("button");
    expect(image.getAttribute("tabindex")).toBe("0");
    expect(image.getAttribute("aria-label")).toContain("A paper");
    expect(image.getAttribute("src")).toBe(
      "https://cdn.example.com/figure.png",
    );
    expect(image.getAttribute("alt")).toContain("A paper");
    expect(image.loading).toBe("lazy");
    expect(image.decoding).toBe("async");
    onClick(new Event("click"));
    const preventDefault = vi.fn();
    onKeydown({ key: "Enter", preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openPreview).toHaveBeenCalledTimes(2);
    onError(new Event("error"));
    expect(removeImageContainer).toHaveBeenCalledOnce();
    expect(removeClass).toHaveBeenCalledWith(
      "rss-reader__item--has-image",
    );
  });

  it("does not create a DOM node when an item has no image", () => {
    const createDiv = vi.fn();
    const container = {
      addClass: vi.fn(),
      createDiv,
    } as unknown as HTMLElement;

    expect(renderItemImage(
      container,
      { imageUrl: null, title: "No image" },
      vi.fn(),
      vi.fn(),
    )).toBeNull();
    expect(createDiv).not.toHaveBeenCalled();
  });
});
