export function parseTier(value: string): "high" | "low" {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "high" || normalized === "low") {
    return normalized;
  }
  throw new Error("LLM 必须严格返回 high 或 low");
}
