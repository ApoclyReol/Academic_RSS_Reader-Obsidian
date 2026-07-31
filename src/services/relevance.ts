import { t } from "../i18n";

export function parseTier(value: string): "high" | "low" {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "high" || normalized === "low") {
    return normalized;
  }
  throw new Error(t("ui.the_llm_must_return_exactly_high_or_low"));
}
