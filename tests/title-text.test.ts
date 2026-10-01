import { describe, expect, it } from "vitest";
import { cleanTitleText } from "../src/models/title-text";

describe("title text", () => {
  it("cleans cached original and translated titles without separating styled letters", () => {
    expect(cleanTitleText('<span class="small-caps">NormasTCU</span> &mdash; 评估&#x20;'))
      .toBe("NormasTCU — 评估");
    expect(cleanTitleText("H<strong>eterogeneous</strong> &amp; H<sub>2</sub>O"))
      .toBe("Heterogeneous & H2O");
    expect(cleanTitleText("&amp;lt;strong&amp;gt;Title&amp;lt;/strong&amp;gt;"))
      .toBe("Title");
  });

  it("preserves formulas, comparisons and plain ampersands", () => {
    const title = "R&D: $x<y>z$ and \\(a > b\\) cost \\$5";
    expect(cleanTitleText(title)).toBe(title);
    expect(cleanTitleText("A<br/>B <script>alert(1)</script><!-- comment -->C"))
      .toBe("A B C");
  });
});
