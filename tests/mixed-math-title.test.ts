import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  renderMath: vi.fn(),
}));

import { renderMath } from "obsidian";

import {
  renderMixedMathTitle,
  splitMixedMathTitle,
  titleContainsMath,
} from "../src/views/mixed-math-title";

describe("mixed math titles", () => {
  it("splits inline and bracketed LaTeX while preserving surrounding text", () => {
    expect(splitMixedMathTitle(
      "Flow at $\\text{Ri}=1$ and \\(x^2+y^2\\).",
    )).toEqual([
      { kind: "text", raw: "Flow at " },
      {
        kind: "math",
        raw: "$\\text{Ri}=1$",
        source: "\\text{Ri}=1",
      },
      { kind: "text", raw: " and " },
      {
        kind: "math",
        raw: "\\(x^2+y^2\\)",
        source: "x^2+y^2",
      },
      { kind: "text", raw: "." },
    ]);
  });

  it("ignores escaped and unclosed dollar delimiters", () => {
    expect(splitMixedMathTitle(
      "Cost \\$5, valid $x_1$, unfinished $y",
    )).toEqual([
      { kind: "text", raw: "Cost \\$5, valid " },
      { kind: "math", raw: "$x_1$", source: "x_1" },
      { kind: "text", raw: ", unfinished $y" },
    ]);
    expect(titleContainsMath("Cost \\$5")).toBe(false);
    expect(titleContainsMath("Energy $E=mc^2$")).toBe(true);
  });

  it("renders formulas inline and falls back to raw text on failure", () => {
    const mathElement = {} as HTMLElement;
    vi.mocked(renderMath)
      .mockReturnValueOnce(mathElement)
      .mockImplementationOnce(() => {
        throw new Error("Invalid LaTeX");
      });
    const text: string[] = [];
    const appendChild = vi.fn();
    const container = {
      appendChild,
      appendText: vi.fn((value: string) => {
        text.push(value);
      }),
    } as unknown as HTMLElement;

    expect(renderMixedMathTitle(
      container,
      "A $x^2$ and $\\broken{$ title",
    )).toBe(true);

    expect(renderMath).toHaveBeenNthCalledWith(1, "x^2", false);
    expect(renderMath).toHaveBeenNthCalledWith(2, "\\broken{", false);
    expect(appendChild).toHaveBeenCalledWith(mathElement);
    expect(text).toEqual(["A ", " and ", "$\\broken{$", " title"]);
  });
});
