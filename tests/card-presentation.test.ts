import { beforeEach, describe, expect, it } from "vitest";

import { setUiLanguage } from "../src/i18n";
import type { RssItem } from "../src/models/domain";
import { DEFAULT_SETTINGS } from "../src/models/settings";
import {
  buildCardPresentation,
  cardLayoutOptions,
  displayAbstract,
} from "../src/views/card-presentation";

describe("paper card presentation", () => {
  beforeEach(() => setUiLanguage("en"));

  it("preserves the v1.5.0 journal and graphical-abstract defaults", () => {
    const item = createItem();
    expect(cardLayoutOptions(DEFAULT_SETTINGS)).toEqual({
      showMetadata: true,
      showAuthors: false,
      showAbstract: false,
      showGraphicalAbstract: true,
    });
    expect(buildCardPresentation(item, DEFAULT_SETTINGS)).toMatchObject({
      journal: "Journal of Testing",
      publicationDate: "",
      doi: "",
      authors: "",
      abstract: "",
      imageUrl: "https://example.com/figure.png",
    });
  });

  it("projects every enabled research field and localizes the date", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      cardShowAuthors: true,
      cardShowPublicationDate: true,
      cardShowDoi: true,
      cardShowAbstract: true,
    };
    const presentation = buildCardPresentation(createItem(), settings);

    expect(presentation.journal).toBe("Journal of Testing");
    expect(presentation.publicationDate).toContain("2026");
    expect(presentation.doi).toBe("10.1000/example");
    expect(presentation.authors).toBe("Alice Example; Bob Example");
    expect(presentation.abstract).toBe("A useful abstract about testing.");
    expect(presentation.imageUrl).toBe("https://example.com/figure.png");
  });

  it("falls back to the year and suppresses every disabled optional field", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      cardShowJournal: false,
      cardShowPublicationDate: true,
      cardShowGraphicalAbstract: false,
    };
    const item = createItem({
      pubDate: "not-a-date",
      year: "2025",
    });
    expect(buildCardPresentation(item, settings)).toMatchObject({
      journal: "",
      publicationDate: "2025",
      doi: "",
      authors: "",
      abstract: "",
      imageUrl: null,
    });

    const allOptionalFieldsOff = {
      ...settings,
      cardShowPublicationDate: false,
    };
    expect(cardLayoutOptions(allOptionalFieldsOff)).toEqual({
      showMetadata: false,
      showAuthors: false,
      showAbstract: false,
      showGraphicalAbstract: false,
    });
  });

  it("does not expose labeled feed metadata as an abstract", () => {
    const item = createItem({
      pubDate: "",
      summary:
        "Publication date: September 2026 " +
        "Source: Journal of Testing, Volume 203 " +
        "Author(s): Alice Example, Bob Example",
    });

    expect(displayAbstract(item)).toBe("");
  });

  it("keeps real prose when it follows labeled feed metadata", () => {
    const summary =
      "Publication date: September 2026 " +
      "Source: Journal of Testing, Volume 203 " +
      "Author(s): Alice Example, Bob Example " +
      "This study presents a concise experimental result.";
    expect(displayAbstract(createItem({ summary }))).toBe(summary);
  });
});

function createItem(overrides: Partial<RssItem> = {}): RssItem {
  return {
    id: 1,
    stableGuid: "paper-card-test",
    title: "A paper about testing",
    titleNorm: "a paper about testing",
    authors: "Alice Example; Bob Example",
    journal: "Journal of Testing",
    feedNames: "Testing feed",
    year: "2026",
    doi: "10.1000/example",
    link: "https://example.com/paper",
    pubDate: "2026-08-24T00:00:00.000Z",
    summary: "A useful abstract about testing.",
    imageUrl: "https://example.com/figure.png",
    firstSeenAt: "2026-08-24T00:00:00.000Z",
    lastSeenAt: "2026-08-24T00:00:00.000Z",
    itemStatus: "unread",
    finalTier: "pending",
    keywordScore: 0.5,
    llmTier: null,
    matchedKeywords: "{}",
    translatedTitle: null,
    translatedAbstract: null,
    titleTranslationStatus: null,
    abstractTranslationStatus: null,
    ...overrides,
  };
}
