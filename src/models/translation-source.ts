import type { TranslationField } from "./domain";
import { cleanTitleText } from "./title-text";

export function translationInputText(field: TranslationField, text: string): string {
  return field === "title" ? cleanTitleText(text) : text;
}
