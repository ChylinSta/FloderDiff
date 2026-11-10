import { diffWordsWithSpace } from "diff";

import type { InlineSpan } from "./types";

export function inlineSpans(left: string, right: string): { left: InlineSpan[]; right: InlineSpan[] } {
  const parts = diffWordsWithSpace(left, right);
  const leftSpans: InlineSpan[] = [];
  const rightSpans: InlineSpan[] = [];
  for (const part of parts) {
    if (part.added) {
      rightSpans.push({ change: "insert", text: part.value });
    } else if (part.removed) {
      leftSpans.push({ change: "delete", text: part.value });
    } else {
      leftSpans.push({ change: "equal", text: part.value });
      rightSpans.push({ change: "equal", text: part.value });
    }
  }
  return { left: mergeSpans(leftSpans), right: mergeSpans(rightSpans) };
}

function mergeSpans(spans: InlineSpan[]): InlineSpan[] {
  const merged: InlineSpan[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.change === span.change) previous.text += span.text;
    else merged.push({ ...span });
  }
  return merged;
}
