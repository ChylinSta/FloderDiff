import { diffChars, diffWordsWithSpace } from "diff";

import type { InlineSpan } from "./types";

export function inlineSpans(left: string, right: string): { left: InlineSpan[]; right: InlineSpan[] } {
  const parts = diffWordsWithSpace(left, right);
  const leftSpans: InlineSpan[] = [];
  const rightSpans: InlineSpan[] = [];
  let index = 0;

  while (index < parts.length) {
    const part = parts[index];
    if (!part) break;
    if (!part.added && !part.removed) {
      pushBoth(leftSpans, rightSpans, part.value);
      index += 1;
      continue;
    }

    let removed = "";
    let added = "";
    if (part.removed) {
      removed = part.value;
      const next = parts[index + 1];
      if (next?.added) {
        added = next.value;
        index += 2;
      } else {
        index += 1;
      }
    } else if (part.added) {
      added = part.value;
      const next = parts[index + 1];
      if (next?.removed) {
        removed = next.value;
        index += 2;
      } else {
        index += 1;
      }
    } else {
      index += 1;
      continue;
    }

    if (removed && added) {
      for (const change of diffChars(removed, added)) {
        if (change.added) rightSpans.push({ change: "insert", text: change.value });
        else if (change.removed) leftSpans.push({ change: "delete", text: change.value });
        else pushBoth(leftSpans, rightSpans, change.value);
      }
    } else if (removed) {
      leftSpans.push({ change: "delete", text: removed });
    } else if (added) {
      rightSpans.push({ change: "insert", text: added });
    }
  }

  return { left: mergeSpans(leftSpans), right: mergeSpans(rightSpans) };
}

function pushBoth(leftSpans: InlineSpan[], rightSpans: InlineSpan[], text: string): void {
  leftSpans.push({ change: "equal", text });
  rightSpans.push({ change: "equal", text });
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
