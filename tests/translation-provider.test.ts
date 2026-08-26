import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

import { requestUrl, type RequestUrlResponse } from "obsidian";

import { setUiLanguage } from "../src/i18n";
import {
  GoogleWebTranslationProvider,
  TranslationRequestError,
} from "../src/services/translation-provider";

const mockedRequestUrl = vi.mocked(requestUrl);

describe("Google web translation provider", () => {
  beforeEach(() => {
    setUiLanguage("en");
    mockedRequestUrl.mockReset();
  });

  it("classifies rate limits and reads Retry-After", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 429,
      headers: { "Retry-After": "2" },
      json: [],
    } as unknown as RequestUrlResponse);

    await expect(
      new GoogleWebTranslationProvider().translate("hello", "auto", "zh-CN"),
    ).rejects.toMatchObject({
      kind: "rate-limit",
      retryable: true,
      retryAfterMs: 2_000,
      status: 429,
    } satisfies Partial<TranslationRequestError>);
  });

  it("returns translated fragments and detected source language", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      headers: {},
      json: [[[
        "你好",
        "hello",
        null,
      ]], null, "en"],
    } as unknown as RequestUrlResponse);

    await expect(
      new GoogleWebTranslationProvider().translate("hello", "auto", "zh-CN"),
    ).resolves.toEqual({
      translatedText: "你好",
      detectedSourceLanguage: "en",
    });
  });

  it("sends the selected target language code to the translation service", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      headers: {},
      json: [[[
        "こんにちは",
        "hello",
        null,
      ]], null, "en"],
    } as unknown as RequestUrlResponse);

    await new GoogleWebTranslationProvider().translate("hello", "auto", "ja");

    const requestArgument = mockedRequestUrl.mock.calls[0]?.[0];
    const requestUrl =
      typeof requestArgument === "string"
        ? requestArgument
        : requestArgument?.url;
    expect(requestUrl).toContain("sl=auto");
    expect(requestUrl).toContain("tl=ja");
  });

  it("treats malformed responses as permanent response errors", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      headers: {},
      json: { unexpected: true },
    } as unknown as RequestUrlResponse);

    await expect(
      new GoogleWebTranslationProvider().translate("hello", "auto", "zh-CN"),
    ).rejects.toMatchObject({
      kind: "response",
      retryable: false,
    } satisfies Partial<TranslationRequestError>);
  });
});
