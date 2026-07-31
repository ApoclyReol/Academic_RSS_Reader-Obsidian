export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 72 * 60 * 60 * 1_000);
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, Math.min(timestamp - now, 72 * 60 * 60 * 1_000))
    : null;
}

export function nextAutomaticAttempt(
  consecutiveFailures: number,
  now = Date.now(),
): string | null {
  const hours =
    consecutiveFailures >= 8
      ? 72
      : consecutiveFailures >= 5
        ? 24
        : consecutiveFailures >= 3
          ? 6
          : 0;
  return hours === 0
    ? null
    : new Date(now + hours * 3_600_000).toISOString();
}
