import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { diffFiles } from "./text-diff";
import type { DiffRow } from "./types";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function files(leftBody: string | Buffer, rightBody: string | Buffer) {
  const root = await mkdtemp(path.join(tmpdir(), "folderdiff-text-"));
  cleanup.push(root);
  const left = path.join(root, "left.txt");
  const right = path.join(root, "right.txt");
  await writeFile(left, leftBody);
  await writeFile(right, rightBody);
  return { left, right };
}

function changes(rows: DiffRow[]) {
  return rows.filter((row) => row.change !== "equal");
}

describe("text diff hunks", () => {
  it("reports identical text with no hunks", async () => {
    const { left, right } = await files("a\nb\n", "a\nb\n");
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("text");
    expect(result.identical).toBe(true);
    expect(result.hunks).toHaveLength(0);
    expect(result.counts.equal).toBe(2);
  });

  it("pairs a replacement as a change row", async () => {
    const { left, right } = await files("alpha\nbeta\n", "alpha\nBETA\n");
    const result = await diffFiles(left, right);
    expect(result.counts.change).toBe(1);
    const hunkRows = result.hunks.flatMap((hunk) => hunk.rows);
    const change = hunkRows.find((row) => row.change === "change");
    expect(change).toMatchObject({ leftText: "beta", rightText: "BETA" });
  });

  it("marks a line that exists only on the right as insert", async () => {
    const { left, right } = await files("a\nc\n", "a\nb\nc\n");
    const result = await diffFiles(left, right);
    expect(result.counts.insert).toBe(1);
    const inserted = result.hunks.flatMap((hunk) => hunk.rows).find((row) => row.change === "insert");
    expect(inserted).toMatchObject({ rightText: "b", leftText: null });
  });

  it("marks a line that exists only on the left as delete", async () => {
    const { left, right } = await files("a\nb\nc\n", "a\nc\n");
    const result = await diffFiles(left, right);
    expect(result.counts.delete).toBe(1);
    const deleted = result.hunks.flatMap((hunk) => hunk.rows).find((row) => row.change === "delete");
    expect(deleted).toMatchObject({ leftText: "b", rightText: null });
  });

  it("builds a hunk with context around a change", async () => {
    const leftLines = ["a", "b", "c", "d", "CHANGE", "e", "f", "g", "h"];
    const rightLines = ["a", "b", "c", "d", "changed", "e", "f", "g", "h"];
    const { left, right } = await files(`${leftLines.join("\n")}\n`, `${rightLines.join("\n")}\n`);
    const result = await diffFiles(left, right);
    expect(result.hunks).toHaveLength(1);
    const rows = result.hunks[0]!.rows;
    expect(rows.length).toBeLessThanOrEqual(7);
    expect(rows.some((row) => row.change === "change")).toBe(true);
    expect(rows.some((row) => row.leftText === "a")).toBe(false);
    expect(rows.some((row) => row.leftText === "h")).toBe(false);
    expect(changes(rows)).toHaveLength(1);
  });

  it("flags CRLF vs LF when the lines otherwise match", async () => {
    const { left, right } = await files("a\nb\n", "a\r\nb\r\n");
    const result = await diffFiles(left, right);
    expect(result.identical).toBe(false);
    expect(result.lineEndingsDiffer).toBe(true);
    expect(result.counts.change).toBe(0);
    expect(result.counts.insert).toBe(0);
    expect(result.counts.delete).toBe(0);
    expect(result.hunks).toHaveLength(0);
  });

  it("does not build text hunks for a null byte", async () => {
    const { left, right } = await files(Buffer.from([0x00, 0x01]), Buffer.from([0x00, 0x02]));
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("binary");
    expect(result.hunks).toHaveLength(0);
    expect(result.identical).toBe(false);
  });

  it("reports identical binaries", async () => {
    const body = Buffer.from([0x00, 0x61, 0x62]);
    const { left, right } = await files(body, Buffer.from(body));
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("binary");
    expect(result.identical).toBe(true);
    expect(result.hunks).toHaveLength(0);
  });

  it("treats invalid UTF-8 as binary", async () => {
    const { left, right } = await files(Buffer.from([0xff, 0xfe]), Buffer.from([0xff, 0xfd]));
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("binary");
    expect(result.binaryReason).toBe("invalid-utf8");
  });

  it("does not invent a phantom empty line", async () => {
    const { left, right } = await files("hello\n", "hello");
    const result = await diffFiles(left, right);
    expect(result.counts.change).toBe(0);
    expect(result.counts.insert).toBe(0);
    expect(result.counts.delete).toBe(0);
    expect(result.lineEndingsDiffer).toBe(true);
    expect(result.identical).toBe(false);
  });

  it("diffs the sample text fixtures", async () => {
    const result = await diffFiles(
      path.resolve("fixtures/files/left.txt"),
      path.resolve("fixtures/files/right.txt"),
    );
    expect(result.kind).toBe("text");
    expect(result.counts.change).toBeGreaterThanOrEqual(1);
    expect(result.counts.insert).toBeGreaterThanOrEqual(1);
    expect(result.counts.delete).toBeGreaterThanOrEqual(1);
  });
});
