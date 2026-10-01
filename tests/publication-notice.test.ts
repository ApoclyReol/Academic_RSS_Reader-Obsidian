import { describe, expect, it } from "vitest";
import { correctionDisplayTitle, isCorrectionTitle } from "../src/models/publication-notice";

describe("correction title presentation", () => {
  it("extracts the quoted subject while retaining correction classification", () => {
    const title = 'Corrigendum to “Body, emotions, and sexuality” [Computers in Human Behavior 161 (2024) 108390]';
    expect(isCorrectionTitle(title)).toBe(true);
    expect(correctionDisplayTitle(title, title)).toBe("Body, emotions, and sexuality");
    expect(correctionDisplayTitle(title, "勘误：身体、情绪和性")).toBe("身体、情绪和性");
  });
  it("handles errata and bounds long subjects without dropping the full stored title", () => {
    const title = `Erratum: ${"文".repeat(200)}`;
    expect(correctionDisplayTitle(title, title)).toBe(`${"文".repeat(140)}…`);
    expect(title).toHaveLength(209);
    expect(isCorrectionTitle("<b>Correction to:</b> A paper")).toBe(true);
    expect(isCorrectionTitle("Correction methods in statistics")).toBe(false);
    expect(correctionDisplayTitle("A paper", "A paper")).toBeNull();
  });
});
