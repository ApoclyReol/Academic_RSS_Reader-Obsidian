import { describe, expect, it } from "vitest";

import {
  canonicalizeLink,
  findDoi,
  parseFeed,
  stableGuid,
  stripHtml,
} from "../src/services/rss-parser";

describe("RSS parser", () => {
  it("parses RSS and preserves the user feed name as journal", () => {
    const result = parseFeed(
      `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Journal A</title>
      <item><title>Example paper</title>
      <link>https://example.com/paper?utm_source=rss</link>
      <description><![CDATA[<p>Authors: Alice; Bob</p><p>DOI: 10.1234/ABC.1</p>]]></description>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
      </channel></rss>`,
      "Fallback",
    );
    expect(result.title).toBe("Journal A");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "Example paper",
      journal: "Fallback",
      doi: "10.1234/abc.1",
      year: "2024",
      link: "https://example.com/paper",
    });
  });

  it("parses Atom alternate links", () => {
    const result = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom">
       <title>Atom Journal</title><entry><title>Atom paper</title>
       <link rel="alternate" href="https://example.org/a?id=1"/>
       <summary>Useful abstract</summary><author><name>Alice</name></author>
       </entry></feed>`,
      "Fallback",
    );
    expect(result.items[0]?.link).toBe("https://example.org/a");
    expect(result.items[0]?.authors).toBe("Alice");
  });

  it("preserves CNKI query parameters", () => {
    const link =
      "https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename=ABC";
    expect(canonicalizeLink(link)).toContain("dbcode=CJFD");
    expect(canonicalizeLink(link)).toContain("filename=ABC");
  });

  it("uses the legacy Streamlit stable GUID rules", () => {
    const base = {
      title: "Same",
      journal: "Journal A",
      year: "2024",
      authors: "A",
      doi: "10.1000/test",
    };
    expect(stableGuid(base)).toBe("doi:10.1000/test");
    expect(stableGuid({ ...base, doi: "" })).toBe(
      "cnki-local:a8f6b94341ff91ff5b05a1b3",
    );
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
      stableGuid({
        ...base,
        doi: "",
        authors: "",
        journal: "Journal A",
      }),
    ).toBe("cnki-local:01700072979c3880ae0cdcfa");
    expect(findDoi("doi:10.1000/XYZ.2")).toBe("10.1000/xyz.2");
    expect(stripHtml("<p>Hello&nbsp;<b>world</b></p>")).toBe("Hello world");
  });
});
