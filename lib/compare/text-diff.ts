import { diffArrays } from "diff";
import { open, readFile, stat } from "node:fs/promises";

import { hashFile } from "./hash";
import type { DiffHunk, DiffRow, FileDiffResult, LineChange } from "./types";
import { assertFile } from "./walk";

const DISPLAY_CAP = 1_000_000;
const CONTEXT = 3;

export async function diffFiles(leftInput: string, rightInput: string): Promise<FileDiffResult> {
  const leftPath = await assertFile(leftInput);
  const rightPath = await assertFile(rightInput);
  const [left, right] = await Promise.all([readForDiff(leftPath), readForDiff(rightPath)]);
  const identical = left.hash === right.hash;

  const leftBinary = sniffBinary(left.sample, left.truncated);
  const rightBinary = sniffBinary(right.sample, right.truncated);
  if (leftBinary || rightBinary) {
    return {
      kind: "binary",
      identical,
      lineEndingsDiffer: false,
      truncated: false,
      binaryReason: left.truncated || right.truncated ? "too-large" : (leftBinary ?? rightBinary)!,
      leftBytes: left.size,
      rightBytes: right.size,
      leftHash: left.hash,
      rightHash: right.hash,
      counts: { equal: 0, insert: 0, delete: 0, change: 0 },
      hunks: [],
    };
  }

  const leftText = decode(left.sample);
  const rightText = decode(right.sample);
  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);
  const rows = alignLines(leftLines, rightLines);
  const counts = countRows(rows);
  const lineEndingsDiffer =
    !identical &&
    !left.truncated &&
    !right.truncated &&
    counts.insert === 0 &&
    counts.delete === 0 &&
    counts.change === 0;
  const truncated = !identical && (left.truncated || right.truncated);

  return {
    kind: "text",
    identical,
    lineEndingsDiffer,
    truncated,
    leftBytes: left.size,
    rightBytes: right.size,
    leftHash: left.hash,
    rightHash: right.hash,
    counts: identical || lineEndingsDiffer ? { ...counts, insert: 0, delete: 0, change: 0 } : counts,
    hunks: identical || lineEndingsDiffer ? [] : buildHunks(rows),
  };
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

function sniffBinary(sample: Buffer, truncated: boolean): FileDiffResult["binaryReason"] | null {
  if (sample.includes(0)) return truncated ? "too-large" : "null-byte";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return null;
  } catch {
    return truncated ? "too-large" : "invalid-utf8";
  }
}

function decode(sample: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(sample);
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
      rows.push(row("change", leftLine, rightLine, removed[cursor] ?? "", added[cursor] ?? ""));
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

