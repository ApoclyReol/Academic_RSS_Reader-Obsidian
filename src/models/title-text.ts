import { decodeHTMLStrict } from "entities";
import { splitMixedMathTitle } from "./title-segments";

/** Normalize feed markup to text without inserting spaces inside styled words. */
export function cleanTitleText(value: string): string {
  let text = value.replace(/<!\[CDATA\[([^]*?)\]\]>/g, "$1");
  // Feeds and cached translations can contain another escaped HTML layer.
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = decodeHTMLStrict(text);
    if (decoded === text) {
      break;
    }
    text = decoded;
  }
  text = text
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:br|p|div|li|h[1-6])\b[^>]*>/gi, " ");
  return splitMixedMathTitle(text)
    .map((segment) => segment.kind === "math"
      ? segment.raw
      : segment.raw.replace(/<\/?[a-z][\w:.-]*(?:\s[^<>]*?)?\s*\/?>/gi, ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
