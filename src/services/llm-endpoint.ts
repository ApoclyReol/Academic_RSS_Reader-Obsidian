import { t } from "../i18n";

export function validateLlmBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(t("ui.the_llm_endpoint_must_use_https_or_local_http"));
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(t("ui.the_llm_endpoint_must_use_https_or_local_http"));
  }
  if (url.username || url.password) {
    throw new Error(t("ui.the_llm_endpoint_must_not_contain_credentials"));
  }
  return url;
}

export function llmCompletionUrl(value: string): string {
  const url = validateLlmBaseUrl(value);
  if (url.search || url.hash) throw new Error(t("translation.endpoint_query"));
  const base = url.toString().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}
