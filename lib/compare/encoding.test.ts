import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { decodeSample, sniffEncoding } from "./encoding";
import { diffFiles } from "./text-diff";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function utf16le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

function utf16be(text: string): Buffer {
  const le = Buffer.from(text, "utf16le");
  const swapped = Buffer.alloc(le.length);
  for (let index = 0; index < le.length; index += 2) {
    swapped[index] = le[index + 1] ?? 0;
    swapped[index + 1] = le[index] ?? 0;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), swapped]);
}

async function files(leftBody: Buffer, rightBody: Buffer) {
  const root = await mkdtemp(path.join(tmpdir(), "folderdiff-encoding-"));
  cleanup.push(root);
  const left = path.join(root, "left.txt");
  const right = path.join(root, "right.txt");
  await writeFile(left, leftBody);
  await writeFile(right, rightBody);
  return { left, right };
}

describe("encoding detection", () => {
  it("decodes a UTF-16 LE BOM as text", () => {
    const sample = utf16le("hello\n");
    expect(sniffEncoding(sample)).toBe("utf-16le");
    expect(decodeSample(sample, "utf-16le").replace(/^\uFEFF/, "")).toBe("hello\n");
  });

  it("decodes a UTF-16 BE BOM as text", () => {
    const sample = utf16be("hello");
    expect(sniffEncoding(sample)).toBe("utf-16be");
    expect(decodeSample(sample, "utf-16be").replace(/^\uFEFF/, "")).toBe("hello");
  });

  it("diffs UTF-16 LE files as text instead of binary", async () => {
    const { left, right } = await files(utf16le("hello\n"), utf16le("hello!\n"));
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("text");
    expect(result.leftEncoding).toBe("utf-16le");
    expect(result.rightEncoding).toBe("utf-16le");
    expect(result.identical).toBe(false);
    const change = result.hunks.flatMap((hunk) => hunk.rows).find((row) => row.change === "change");
    expect(change?.rightSpans?.some((span) => span.change === "insert" && span.text.includes("!"))).toBe(true);
  });

  it("reports matching text stored in different encodings", async () => {
    const { left, right } = await files(utf16le("hello\n"), Buffer.from("hello\n", "utf8"));
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("text");
    expect(result.identical).toBe(false);
    expect(result.encodingsDiffer).toBe(true);
    expect(result.counts.change).toBe(0);
    expect(result.hunks).toHaveLength(0);
  });

  it("keeps a null byte without a BOM binary", () => {
    expect(sniffEncoding(Buffer.from([0x00, 0x61]))).toBe("binary");
  });
});
