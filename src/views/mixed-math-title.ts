import { renderMath } from "obsidian";

export type TitleSegment =
  | { kind: "text"; raw: string }
  | { kind: "math"; raw: string; source: string };

const MATH_DELIMITERS = [
  { open: "$$", close: "$$" },
  { open: "\\[", close: "\\]" },
  { open: "\\(", close: "\\)" },
  { open: "$", close: "$" },
] as const;

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function closingDelimiterIndex(
  value: string,
  delimiter: string,
  fromIndex: number,
): number {
  let index = value.indexOf(delimiter, fromIndex);
  while (index >= 0) {
    if (!isEscaped(value, index)) {
      return index;
    }
    index = value.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
}

export function splitMixedMathTitle(title: string): TitleSegment[] {
  const segments: TitleSegment[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < title.length) {
    const delimiter = MATH_DELIMITERS.find(({ open }) =>
      title.startsWith(open, cursor) && !isEscaped(title, cursor)
    );
    if (!delimiter) {
      cursor += 1;
      continue;
    }
    const sourceStart = cursor + delimiter.open.length;
    const closeIndex = closingDelimiterIndex(
      title,
      delimiter.close,
      sourceStart,
    );
    if (closeIndex < 0) {
      cursor = sourceStart;
      continue;
    }
    const source = title.slice(sourceStart, closeIndex).trim();
    if (!source) {
      cursor = closeIndex + delimiter.close.length;
      continue;
    }
    if (cursor > textStart) {
      segments.push({
        kind: "text",
        raw: title.slice(textStart, cursor),
      });
    }
    const segmentEnd = closeIndex + delimiter.close.length;
    segments.push({
      kind: "math",
      raw: title.slice(cursor, segmentEnd),
      source,
    });
    cursor = segmentEnd;
    textStart = segmentEnd;
  }

  if (textStart < title.length) {
    segments.push({ kind: "text", raw: title.slice(textStart) });
  }
  return segments.length > 0 ? segments : [{ kind: "text", raw: title }];
}

export function titleContainsMath(title: string): boolean {
  return splitMixedMathTitle(title).some((segment) => segment.kind === "math");
}

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
