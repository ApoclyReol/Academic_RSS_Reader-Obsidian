import { describe, expect, it } from "vitest";

import {
  nextAutomaticAttempt,
  parseRetryAfter,
} from "../src/services/feed-scheduling";

describe("feed update scheduling", () => {
  it("parses Retry-After seconds and dates", () => {
    const now = Date.parse("2026-07-30T00:00:00Z");
    expect(parseRetryAfter("5", now)).toBe(5_000);
    expect(
      parseRetryAfter("Thu, 30 Jul 2026 00:01:00 GMT", now),
    ).toBe(60_000);
    expect(parseRetryAfter("invalid", now)).toBeNull();
  });

  it("backs off automatic updates at 3, 5 and 8 failures", () => {
    const now = Date.parse("2026-07-30T00:00:00Z");
    expect(nextAutomaticAttempt(2, now)).toBeNull();
    expect(Date.parse(nextAutomaticAttempt(3, now)!) - now)
      .toBe(6 * 3_600_000);
    expect(Date.parse(nextAutomaticAttempt(5, now)!) - now)
      .toBe(24 * 3_600_000);
    expect(Date.parse(nextAutomaticAttempt(8, now)!) - now)
      .toBe(72 * 3_600_000);
  });
});
