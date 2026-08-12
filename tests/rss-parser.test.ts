import { describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import {
  canonicalizeLink,
  findDoi,
  MAX_FEED_XML_BYTES,
  parseFeed,
  publisherIdentity,
  stableGuid,
  stripHtml,
  validateFeedXml,
} from "../src/services/rss-parser";

describe("RSS parser", () => {
  it("parses RSS and uses the feed fallback when no article journal exists", () => {
    const result = parseFeed(
      `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Journal A</title>
      <item><title>Example paper</title>
      <link>https://example.com/paper?utm_source=rss</link>
      <description><![CDATA[<p>Authors: Alice; Bob</p><p>DOI: 10.1234/ABC.1</p>]]></description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
      </channel></rss>`,
      "Fallback",
      "Configured journal",
    );
    expect(result.title).toBe("Journal A");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "Example paper",
      journal: "Configured journal",
      doi: "10.1234/abc.1",
      year: "2024",
      link: "https://example.com/paper",
    });
  });

  it("parses Atom alternate links and preserves business query parameters", () => {
    const result = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom">
       <title>Atom Journal</title><entry><title>Atom paper</title>
       <link rel="alternate" href="https://example.org/a?id=1"/>
       <summary>Useful abstract</summary><author><name>Alice</name></author>
       </entry></feed>`,
      "Fallback",
    );
    expect(result.items[0]?.link).toBe("https://example.org/a?id=1");
    expect(result.items[0]?.authors).toBe("Alice");
  });

  it("preserves business query parameters and removes known tracking parameters", () => {
    const link =
      "https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename=ABC";
    expect(canonicalizeLink(link)).toContain("dbcode=CJFD");
    expect(canonicalizeLink(link)).toContain("filename=ABC");
    expect(
      canonicalizeLink("https://example.com/paper?id=1&utm_source=rss&fbclid=x"),
    ).toBe("https://example.com/paper?id=1");
    expect(
      canonicalizeLink(
        "https://www.sciencedirect.com/science/article/pii/S123?dgcid=rss_sd_all",
      ),
    ).toBe(
      "https://www.sciencedirect.com/science/article/pii/S123",
    );
    expect(canonicalizeLink("javascript:alert(1)")).toBe("");
  });

  it("uses DOI, author, and journal identities without making URLs the primary GUID", () => {
    const base = {
      title: "Same",
      journal: "Journal A",
      year: "2024",
      authors: "A",
      doi: "10.1000/test",
    };
    expect(stableGuid(base)).toBe("doi:10.1000/test");
    expect(stableGuid({ ...base, doi: "" })).toMatch(/^cnki-local:/);
    expect(
      stableGuid({ ...base, doi: "", journal: "Renamed journal" }),
    ).toBe(stableGuid({ ...base, doi: "" }));
    expect(
      stableGuid({ ...base, doi: "", authors: "", journal: "Journal B" }),
    ).not.toBe(
      stableGuid({
        ...base,
        doi: "",
        authors: "",
        journal: "Journal A",
      }),
    );
    expect(
      stableGuid({ ...base, doi: "", link: "https://example.com/a?id=1" }),
    ).toBe(stableGuid({ ...base, doi: "" }));
    const noAuthor = { ...base, doi: "", authors: "" };
    expect(stableGuid({
      ...noAuthor,
      link:
        "https://www.sciencedirect.com/science/article/pii/S0268401226000514",
    })).not.toBe(stableGuid({
      ...noAuthor,
      link:
        "https://www.sciencedirect.com/science/article/pii/S0268401226000733",
    }));
    expect(findDoi("doi:10.1000/XYZ.2")).toBe("10.1000/xyz.2");
    expect(stripHtml("<p>Hello&nbsp;<b>world</b></p>")).toBe("Hello world");
  });

  it("extracts a stable ScienceDirect PII regardless of query parameters", () => {
    const plain =
      "https://www.sciencedirect.com/science/article/pii/S0268401226000587";
    expect(publisherIdentity(plain)).toBe(
      "sciencedirect-pii:S0268401226000587",
    );
    expect(publisherIdentity(`${plain}?dgcid=rss_sd_all`)).toBe(
      publisherIdentity(plain),
    );
    expect(publisherIdentity("https://example.com/article/1")).toBe("");
  });

  it("rejects invalid XML, HTML error pages, DOCTYPE, and oversized bodies", () => {
    expect(() => parseFeed("<html><body>502 Bad Gateway</body></html>", "Fallback"))
      .toThrow(t("feed.invalid_root"));
    expect(() => validateFeedXml("<rss><channel></rss>"))
      .toThrow(/RSS\/Atom XML/);
    expect(() => validateFeedXml(
      "<!DOCTYPE rss [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><rss />",
    )).toThrow(t("feed.doctype_rejected"));
    expect(() => validateFeedXml("x".repeat(MAX_FEED_XML_BYTES + 1)))
      .toThrow(t("feed.response_too_large"));
  });

  it("accepts a valid empty RSS feed", () => {
    expect(parseFeed(
      "<rss version='2.0'><channel><title>Empty</title></channel></rss>",
      "Fallback",
    )).toEqual({ title: "Empty", items: [] });
    expect(parseFeed(
      "<rss version='2.0'><channel /></rss>",
      "Fallback",
    )).toEqual({ title: "Fallback", items: [] });
    expect(parseFeed(
      "<feed xmlns='http://www.w3.org/2005/Atom' />",
      "Fallback",
    )).toEqual({ title: "Fallback", items: [] });
  });

  it("rejects unsafe protocols for article links", () => {
    expect(canonicalizeLink("file:///tmp/paper.pdf")).toBe("");
    expect(canonicalizeLink("data:text/plain,paper")).toBe("");
  });
});
