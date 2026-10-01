import { renderMath } from "obsidian";
import { splitMixedMathTitle } from "../models/title-segments";

export {
  splitMixedMathTitle,
  titleContainsMath,
  type TitleSegment,
} from "../models/title-segments";

export function renderMixedMathTitle(
  container: HTMLElement,
  title: string,
): boolean {
  let renderedMath = false;
  for (const segment of splitMixedMathTitle(title)) {
    if (segment.kind === "text") {
      container.appendText(segment.raw);
      continue;
    }
    try {
      container.appendChild(renderMath(segment.source, false));
      renderedMath = true;
    } catch {
      container.appendText(segment.raw);
    }
  }
  return renderedMath;
}
