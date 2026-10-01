/** Unread papers have no decision; expiry preserves a negative decision. */
export function interestRate(counts: Record<string, unknown>): number {
  const positive = Number(counts.interested_count ?? 0) +
    Number(counts.archived_count ?? 0);
  const negative = Number(counts.hidden_count ?? 0) +
    Number(counts.expired_count ?? 0);
  const reviewed = positive + negative;
  return reviewed > 0 ? positive / reviewed : 0;
}
