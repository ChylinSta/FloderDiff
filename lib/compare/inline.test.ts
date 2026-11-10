import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inlineSpans } from "./inline";
import { diffFiles } from "./text-diff";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("inline highlight", () => {
  it("marks the changed word inside a line", () => {
    const spans = inlineSpans("const value = 1;", "const value = 2;");
    expect(spans.left.some((span) => span.change === "delete" && span.text === "1")).toBe(true);
    expect(spans.right.some((span) => span.change === "insert" && span.text === "2")).toBe(true);
    expect(spans.left.some((span) => span.change === "equal" && span.text.includes("const value"))).toBe(true);
  });

  it("attaches word spans to a changed diff row", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-inline-"));
    cleanup.push(root);
    const left = path.join(root, "left.txt");
    const right = path.join(root, "right.txt");
    await writeFile(left, "return 1;\n");
    await writeFile(right, "return 2;\n");
    const result = await diffFiles(left, right);
    const change = result.hunks.flatMap((hunk) => hunk.rows).find((row) => row.change === "change");
    expect(change?.leftSpans?.map((span) => span.text).join("")).toBe("return 1;");
    expect(change?.rightSpans?.some((span) => span.change === "insert" && span.text === "2")).toBe(true);
    expect(change?.leftSpans?.some((span) => span.change === "delete" && span.text === "1")).toBe(true);
  });
});
