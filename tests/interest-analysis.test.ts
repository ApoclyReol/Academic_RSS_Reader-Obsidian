import { describe, expect, it } from "vitest";
import { interestRate } from "../src/views/interest-analysis";

describe("interest rate", () => {
  it("includes archived positives and expired negatives, excluding unread papers", () => {
    expect(interestRate({
      interested_count: 0, archived_count: 1, hidden_count: 2,
      expired_count: 17, unread_count: 7,
    })).toBe(0.05);
    expect(interestRate({
      interested_count: 2, archived_count: 3, hidden_count: 15,
      expired_count: 31, unread_count: 2,
    })).toBeCloseTo(5 / 51);
  });

  it("keeps the rate constant when a hidden paper expires", () => {
    const counts = {
      interested_count: 2, archived_count: 3, hidden_count: 15, expired_count: 31,
    };
    expect(interestRate({ ...counts, hidden_count: 14, expired_count: 32 }))
      .toBe(interestRate(counts));
  });

  it("handles an empty or entirely unread feed and one-sided decisions", () => {
    expect(interestRate({})).toBe(0);
    expect(interestRate({ unread_count: 30 })).toBe(0);
    expect(interestRate({ archived_count: 2 })).toBe(1);
    expect(interestRate({ expired_count: 2 })).toBe(0);
  });
});
