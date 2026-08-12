export interface RecommendationExplanation {
  positive: string[];
  negative: string[];
}

export function recommendationExplanation(
  value: string,
): RecommendationExplanation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  const terms = (key: string): string[] =>
    Array.isArray(record[key])
      ? record[key]
          .filter(
            (entry): entry is { keyword: string } =>
              Boolean(
                entry &&
                  typeof entry === "object" &&
                  "keyword" in entry &&
                  typeof (entry as { keyword?: unknown }).keyword ===
                    "string",
              ),
          )
          .map((entry) => entry.keyword)
      : [];
  const positive = terms("positive");
  const negative = terms("negative");
  const context = [...positive, ...negative].filter((term) =>
    /^(?:author|journal|feed|freshness):/.test(term),
  );
  return {
    positive: positive.filter((term) => !context.includes(term)).slice(0, 3),
    negative: negative.filter((term) => !context.includes(term)).slice(0, 3),
  };
}
