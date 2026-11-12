import { diffArrays } from "diff";
import { open, readFile, stat } from "node:fs/promises";

import { decodeSample, sniffEncoding } from "./encoding";
import { hashFile } from "./hash";
import { inlineSpans } from "./inline";
import type { DiffHunk, DiffRow, FileDiffResult, LineChange } from "./types";
import { assertFile } from "./walk";

const DISPLAY_CAP = 1_000_000;
const CONTEXT = 3;

export async function diffFiles(leftInput: string, rightInput: string): Promise<FileDiffResult> {
  const leftPath = await assertFile(leftInput);
  const rightPath = await assertFile(rightInput);
  const [left, right] = await Promise.all([readForDiff(leftPath), readForDiff(rightPath)]);
  const identical = left.hash === right.hash;

  const leftEncoding = sniffEncoding(left.sample);
  const rightEncoding = sniffEncoding(right.sample);
  if (leftEncoding === "binary" || rightEncoding === "binary") {
    const reason = binaryReason(left.sample, left.truncated, leftEncoding) ??
      binaryReason(right.sample, right.truncated, rightEncoding);
    return {
      kind: "binary",
      identical,
      lineEndingsDiffer: false,
      encodingsDiffer: false,
      truncated: false,
      binaryReason: reason ?? "invalid-utf8",
      leftBytes: left.size,
      rightBytes: right.size,
      leftHash: left.hash,
      rightHash: right.hash,
      counts: { equal: 0, insert: 0, delete: 0, change: 0 },
      hunks: [],
    };
  }

  const leftText = decodeSample(left.sample, leftEncoding);
  const rightText = decodeSample(right.sample, rightEncoding);
  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);
  const rows = alignLines(leftLines, rightLines);
  const counts = countRows(rows);
  const encodingsDiffer = leftEncoding !== rightEncoding;
  const textMatches =
    counts.insert === 0 && counts.delete === 0 && counts.change === 0;
  const lineEndingsDiffer =
    !identical && !left.truncated && !right.truncated && textMatches && !encodingsDiffer;
  const truncated = !identical && (left.truncated || right.truncated);
  const quiet = identical || lineEndingsDiffer || (textMatches && encodingsDiffer);

  return {
    kind: "text",
    identical,
    lineEndingsDiffer,
    encodingsDiffer,
    truncated,
    leftBytes: left.size,
    rightBytes: right.size,
    leftHash: left.hash,
    rightHash: right.hash,
    leftEncoding,
    rightEncoding,
    counts: quiet ? { ...counts, insert: 0, delete: 0, change: 0 } : counts,
    hunks: quiet ? [] : buildHunks(rows),
  };
}

function binaryReason(
  sample: Buffer,
  truncated: boolean,
  encoding: ReturnType<typeof sniffEncoding>,
): FileDiffResult["binaryReason"] | null {
  if (encoding !== "binary") return null;
  if (truncated) return "too-large";
  if (sample.includes(0)) return "null-byte";
  return "invalid-utf8";
}

type Loaded = {
  size: number;
  hash: string;
  sample: Buffer;
  truncated: boolean;
};

async function readForDiff(absolutePath: string): Promise<Loaded> {
  const info = await stat(absolutePath);
  const hash = await hashFile(absolutePath);
  if (info.size <= DISPLAY_CAP) {
    const sample = await readFile(absolutePath);
    return { size: info.size, hash, sample, truncated: false };
  }
  const handle = await open(absolutePath, "r");
  try {
    const sample = Buffer.alloc(DISPLAY_CAP);
    await handle.read(sample, 0, DISPLAY_CAP, 0);
    return { size: info.size, hash, sample, truncated: true };
  } finally {
    await handle.close();
  }
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  if (normalized.endsWith("\n")) parts.pop();
  return parts;
}

function alignLines(leftLines: string[], rightLines: string[]): DiffRow[] {
  const parts = diffArrays(leftLines, rightLines);
  const rows: DiffRow[] = [];
  let leftLine = 0;
  let rightLine = 0;
  let index = 0;

  while (index < parts.length) {
    const part = parts[index];
    if (!part) break;
    if (!part.added && !part.removed) {
      for (const line of part.value) {
        leftLine += 1;
        rightLine += 1;
        rows.push(row("equal", leftLine, rightLine, line, line));
      }
      index += 1;
      continue;
    }

    let removed: string[] = [];
    let added: string[] = [];
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

    const paired = Math.min(removed.length, added.length);
    for (let cursor = 0; cursor < paired; cursor += 1) {
      leftLine += 1;
      rightLine += 1;
      const leftText = removed[cursor] ?? "";
      const rightText = added[cursor] ?? "";
      const spans = inlineSpans(leftText, rightText);
      rows.push({
        ...row("change", leftLine, rightLine, leftText, rightText),
        leftSpans: spans.left,
        rightSpans: spans.right,
      });
    }
    for (let cursor = paired; cursor < removed.length; cursor += 1) {
      leftLine += 1;
      rows.push(row("delete", leftLine, null, removed[cursor] ?? "", null));
    }
    for (let cursor = paired; cursor < added.length; cursor += 1) {
      rightLine += 1;
      rows.push(row("insert", null, rightLine, null, added[cursor] ?? ""));
    }
  }

  return rows;
}

function row(
  change: LineChange,
  leftLine: number | null,
  rightLine: number | null,
  leftText: string | null,
  rightText: string | null,
): DiffRow {
  return { change, leftLine, rightLine, leftText, rightText };
}

function countRows(rows: DiffRow[]): FileDiffResult["counts"] {
  const counts = { equal: 0, insert: 0, delete: 0, change: 0 };
  for (const line of rows) counts[line.change] += 1;
  return counts;
}

export function buildHunks(rows: DiffRow[]): DiffHunk[] {
  const ranges: Array<[number, number]> = [];
  rows.forEach((line, index) => {
    if (line.change === "equal") return;
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(rows.length - 1, index + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  });

  return ranges.map(([start, end]) => {
    const slice = rows.slice(start, end + 1);
    const leftNumbers = slice
      .map((line) => line.leftLine)
      .filter((line): line is number => line !== null);
    const rightNumbers = slice
      .map((line) => line.rightLine)
      .filter((line): line is number => line !== null);
    return {
      leftStart: leftNumbers[0] ?? 1,
      leftCount: leftNumbers.length,
      rightStart: rightNumbers[0] ?? 1,
      rightCount: rightNumbers.length,
      rows: slice,
    };
  });
}

