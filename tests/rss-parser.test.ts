import { describe, expect, it } from "vitest";

import { t } from "../src/i18n";
import {
  canonicalizeLink,
  canonicalizeImageUrl,
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

  it("extracts labeled journal and authors without changing the plain-text summary", () => {
    const result = parseFeed(
      `<rss version="2.0"><channel>
        <title>ScienceDirect Publication: International Journal of Multiphase Flow</title>
        <item>
          <title>Multiphase paper</title>
          <link>https://www.sciencedirect.com/science/article/pii/S123</link>
          <description><![CDATA[
            <p>Publication date: September 2026</p>
            <p><b>Source:</b> International Journal of Multiphase Flow, Volume 203</p>
            <p>Author(s): Alice Example, Bob Example</p>
          ]]></description>
        </item>
      </channel></rss>`,
      "Fallback",
      "Configured fallback",
    );

    expect(result.items[0]).toMatchObject({
      articleJournal: "International Journal of Multiphase Flow",
      authors: "Alice Example, Bob Example",
      journal: "International Journal of Multiphase Flow",
      summary:
        "Publication date: September 2026 Source: International Journal of Multiphase Flow, Volume 203 Author(s): Alice Example, Bob Example",
    });
  });

  it("extracts item images in priority order and keeps summaries as text", () => {
    const result = parseFeed(
      `<rss version="2.0"
        xmlns:media="http://search.yahoo.com/mrss/"
        xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Image sources</title>
          <image><url>https://example.com/channel-logo.png</url></image>
          <item>
            <title>Media content</title>
            <media:content url="https://example.com/media.png" type="image/png"/>
            <media:thumbnail url="https://example.com/thumbnail.png"/>
            <enclosure url="https://example.com/enclosure.jpg" type="image/jpeg"/>
            <description><![CDATA[<p>Abstract text</p><img src="https://example.com/html.png"/>]]></description>
          </item>
          <item>
            <title>Media thumbnail</title>
            <media:thumbnail url="//cdn.example.com/thumbnail.png"/>
            <description>Thumbnail abstract</description>
          </item>
          <item>
            <title>RSS enclosure</title>
            <enclosure url="https://example.com/enclosure.jpg" type="image/jpeg"/>
            <description>Enclosure abstract</description>
          </item>
          <item>
            <title>HTML image</title>
            <description>HTML abstract</description>
            <content:encoded><![CDATA[<p>HTML abstract</p><img src="https://example.com/figure.png" width="200" height="100"/>]]></content:encoded>
          </item>
          <item>
            <title>No item image</title>
            <description>Only text</description>
          </item>
        </channel>
      </rss>`,
      "Fallback",
    );

    expect(result.items.map((item) => item.imageUrl)).toEqual([
      "https://example.com/media.png",
      "https://cdn.example.com/thumbnail.png",
      "https://example.com/enclosure.jpg",
      "https://example.com/figure.png",
      undefined,
    ]);
    expect(result.items[0]?.summary).toBe("Abstract text");
    expect(result.items[4]?.imageUrl).toBeUndefined();
  });

  it("extracts Atom enclosure links after RSS enclosures", () => {
    const result = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom images</title>
        <entry>
          <title>Atom paper</title>
          <link rel="alternate" href="https://example.com/paper"/>
          <link rel="enclosure" href="https://example.com/graphical-abstract.webp" type="image/webp"/>
          <summary>Atom abstract</summary>
        </entry>
      </feed>`,
      "Fallback",
    );

    expect(result.items[0]).toMatchObject({
      link: "https://example.com/paper",
      imageUrl: "https://example.com/graphical-abstract.webp",
      summary: "Atom abstract",
    });
  });

  it("rejects unsafe and decorative image fields and falls through", () => {
    const result = parseFeed(
      `<rss version="2.0"
        xmlns:media="http://search.yahoo.com/mrss/"
        xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel><title>Invalid images</title><item>
          <title>Safe fallback</title>
          <media:content url="data:image/png;base64,abc" type="image/png"/>
          <media:content url="https://example.com/logo.png" type="image/png"/>
          <media:thumbnail url="https://example.com/tracking-pixel.png"/>
          <enclosure url="https://example.com/video.png" type="video/mp4"/>
          <description><![CDATA[
            <img src="https://example.com/logo.png" alt="journal logo"/>
            <img data-src="https://example.com/lazy-placeholder.png" width="200" height="100"/>
            <img src="/relative/figure.png" width="200" height="100"/>
            <img src="https://example.com/paper-figure.png" width="200" height="100"/>
          ]]></description>
        </item></channel></rss>`,
      "Fallback",
    );

    expect(result.items[0]?.imageUrl).toBe(
      "https://example.com/paper-figure.png",
    );
    expect(canonicalizeImageUrl("javascript:alert(1)")).toBe("");
    expect(canonicalizeImageUrl("/relative/image.png")).toBe("");
    expect(canonicalizeImageUrl("https://example.com/a.png?x=1&utm_source=rss"))
      .toBe("https://example.com/a.png?x=1&utm_source=rss");
  });

  it("parses RSS 1.0 RDF feeds used by Nature journals", () => {
    const result = parseFeed(
      `<rdf:RDF
        xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:content="http://purl.org/rss/1.0/modules/content/"
        xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"
        xmlns="http://purl.org/rss/1.0/">
        <channel rdf:about="https://www.nature.com/palcomms.rss">
          <title>Humanities and Social Sciences Communications</title>
        </channel>
        <item rdf:about="https://www.nature.com/articles/s41599-026-08691-x">
          <title><![CDATA[Service trade liberalization]]></title>
          <link>https://www.nature.com/articles/s41599-026-08691-x</link>
          <content:encoded><![CDATA[
            <p>doi:10.1057/s41599-026-08691-x</p>
          ]]></content:encoded>
          <dc:creator>Men Zhang</dc:creator>
          <dc:creator>Yong Zhou</dc:creator>
          <dc:identifier>doi:10.1057/s41599-026-08691-x</dc:identifier>
          <dc:date>2026-08-12</dc:date>
          <prism:publicationName>
            Humanities and Social Sciences Communications
          </prism:publicationName>
        </item>
      </rdf:RDF>`,
      "Nature fallback",
    );

    expect(result.title).toBe(
      "Humanities and Social Sciences Communications",
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "Service trade liberalization",
      authors: "Men Zhang; Yong Zhou",
      journal: "Humanities and Social Sciences Communications",
      year: "2026",
      doi: "10.1057/s41599-026-08691-x",
      link: "https://www.nature.com/articles/s41599-026-08691-x",
    });
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
    expect(parseFeed(
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <channel />
      </rdf:RDF>`,
      "Fallback",
    )).toEqual({ title: "Fallback", items: [] });
  });

  it("rejects unsafe protocols for article links", () => {
    expect(canonicalizeLink("file:///tmp/paper.pdf")).toBe("");
    expect(canonicalizeLink("data:text/plain,paper")).toBe("");
  });
});
