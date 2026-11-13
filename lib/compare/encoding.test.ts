import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { decodeSample, sniffEncoding, sniffUtf16WithoutBom } from "./encoding";
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

  it("decodes UTF-16 LE without a BOM when the null-byte pattern is clear", async () => {
    const sample = Buffer.from("hello\n", "utf16le");
    expect(sample.length % 2).toBe(0);
    expect(sample.includes(0)).toBe(true);
    expect(sniffEncoding(sample)).toBe("utf-16le");
    expect(decodeSample(sample, "utf-16le")).toBe("hello\n");

    const { left, right } = await files(sample, Buffer.from("hello!\n", "utf16le"));
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("text");
    expect(result.leftEncoding).toBe("utf-16le");
    expect(result.hunks.flatMap((hunk) => hunk.rows).some((row) => row.change === "change")).toBe(true);
  });

  it("keeps mixed binary with a stray null as binary", () => {
    expect(sniffEncoding(Buffer.from([0x01, 0x02, 0x00, 0x03, 0x04, 0x05, 0x06, 0x07]))).toBe("binary");
  });

  it("decodes Chinese UTF-16 LE and BE fixtures without a BOM", async () => {
    const text = "你好，世界。\n文件夹比较。\n";
    const le = Buffer.from(text, "utf16le");
    const be = swapUtf16(le);
    expect(sniffEncoding(le)).toBe("utf-16le");
    expect(sniffEncoding(be)).toBe("utf-16be");
    expect(decodeSample(le, "utf-16le")).toBe(text);
    expect(decodeSample(be, "utf-16be")).toBe(text);

    const fixtureLe = await readFixture("zh-utf16le.txt");
    const fixtureBe = await readFixture("zh-utf16be.txt");
    expect(sniffEncoding(fixtureLe)).toBe("utf-16le");
    expect(sniffEncoding(fixtureBe)).toBe("utf-16be");
    expect(decodeSample(fixtureLe, "utf-16le")).toBe(text);

    const { left, right } = await files(le, be);
    const result = await diffFiles(left, right);
    expect(result.kind).toBe("text");
    expect(result.identical).toBe(false);
    expect(result.encodingsDiffer).toBe(true);
    expect(result.hunks).toHaveLength(0);
  });

  it("decodes a short ASCII UTF-16 sample of at least two characters", () => {
    const le = Buffer.from("hi", "utf16le");
    const be = swapUtf16(le);
    expect(le.length).toBe(4);
    expect(sniffEncoding(le)).toBe("utf-16le");
    expect(sniffEncoding(be)).toBe("utf-16be");
    expect(decodeSample(le, "utf-16le")).toBe("hi");
    expect(sniffEncoding(Buffer.from("hi!", "utf16le"))).toBe("utf-16le");
    expect(sniffEncoding(Buffer.from("A", "utf16le"))).toBe("binary");
  });

  it("does not guess when both UTF-16 endiannesses look like text", () => {
    const ambiguous = Buffer.from([0x80, 0x30, 0x80, 0x30, 0x80, 0x30, 0x80, 0x30]);
    expect(sniffUtf16WithoutBom(ambiguous)).toBeNull();
    expect(sniffEncoding(ambiguous)).toBe("binary");
  });

  it("keeps UTF-8 Chinese and odd-length binary as themselves", () => {
    const utf8 = Buffer.from("你好，世界。文件夹比较还要更长一点。\n", "utf8");
    expect(sniffEncoding(utf8)).toBe("utf-8");
    expect(sniffEncoding(Buffer.from([0x00, 0x41, 0x00]))).toBe("binary");
    expect(sniffEncoding(Buffer.alloc(16, 0xff))).toBe("binary");
  });
});

function swapUtf16(le: Buffer): Buffer {
  const be = Buffer.alloc(le.length);
  for (let index = 0; index < le.length; index += 2) {
    be[index] = le[index + 1] ?? 0;
    be[index + 1] = le[index] ?? 0;
  }
  return be;
}

async function readFixture(name: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path.resolve("fixtures/files", name));
}
