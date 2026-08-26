import { beforeEach, describe, expect, it, vi } from "vitest";

import { setUiLanguage } from "../src/i18n";
import {
  renderCardLabeledField,
  renderCardMetadata,
} from "../src/views/card-fields";

interface ElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

describe("paper card field renderers", () => {
  beforeEach(() => setUiLanguage("en"));

  it("renders metadata in journal, date, and DOI order without a flex spacer", () => {
    const spans: ElementOptions[] = [];
    const metadata = {
      createSpan: vi.fn((options: ElementOptions) => {
        spans.push(options);
        return metadata;
      }),
    };
    const container = {
      createEl: vi.fn((_tag: string, _options: ElementOptions) => metadata),
    } as unknown as HTMLElement;

    renderCardMetadata(container, {
      journal: "Journal A",
      publicationDate: "Aug 24, 2026",
      doi: "10.1000/example",
      authors: "",
      abstract: "",
      imageUrl: null,
    });

    expect(spans.map((span) => span.cls)).toEqual([
      "rss-reader__item-metadata-field is-journal",
      "rss-reader__item-metadata-field is-publication-date",
      "rss-reader__item-metadata-field is-doi",
    ]);
    expect(spans.map((span) => span.text)).toEqual([
      "Journal A",
      "Aug 24, 2026",
      "DOI: 10.1000/example",
    ]);
  });

  it("renders labels and values as separate safe text nodes with full titles", () => {
    const spans: ElementOptions[] = [];
    const row = {
      createSpan: vi.fn((options: ElementOptions) => {
        spans.push(options);
        return row;
      }),
    };
    const container = {
      createEl: vi.fn((_tag: string, options: ElementOptions) => {
        expect(options.cls).toBe("rss-reader__item-authors");
        expect(options.attr?.title).toBe("<b>Alice</b>");
        return row;
      }),
    } as unknown as HTMLElement;

    renderCardLabeledField(
      container,
      "rss-reader__item-authors",
      "Authors",
      "<b>Alice</b>",
    );

    expect(spans).toEqual([
      {
        cls: "rss-reader__item-field-label",
        text: "Authors:",
      },
      {
        cls: "rss-reader__item-field-value",
        text: "<b>Alice</b>",
        attr: { title: "<b>Alice</b>" },
      },
    ]);
  });

  it("keeps an enabled empty field row without adding placeholder text", () => {
    const createSpan = vi.fn();
    const row = { createSpan };
    const container = {
      createEl: vi.fn(() => row),
    } as unknown as HTMLElement;

    renderCardLabeledField(
      container,
      "rss-reader__item-abstract",
      "Abstract",
      "",
    );

    expect(createSpan).not.toHaveBeenCalled();
  });
});
