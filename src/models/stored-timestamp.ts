/** SQLite CURRENT_TIMESTAMP is UTC even though it has no timezone suffix. */
export function normalizeStoredTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
}
