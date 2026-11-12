import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compareFolders } from "./folder";
import { compileIgnore, DEFAULT_IGNORE } from "./ignore";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function pair() {
  const root = await mkdtemp(path.join(tmpdir(), "folderdiff-ignore-"));
  cleanup.push(root);
  const left = path.join(root, "left");
  const right = path.join(root, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  return { left, right };
}

async function file(root: string, relativePath: string, body = "x\n") {
  const absolute = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
}

describe("ignore patterns", () => {
  it("default patterns skip node_modules, .git, and .DS_Store", async () => {
    const { left, right } = await pair();
    await file(left, "src/a.ts", "export const a = 1;\n");
    await file(right, "src/a.ts", "export const a = 1;\n");
    await file(left, "node_modules/pkg/index.js");
    await file(right, "node_modules/pkg/index.js", "other\n");
    await file(left, ".git/config", "[core]\n");
    await file(right, ".git/HEAD", "ref: refs/heads/main\n");
    await file(left, ".DS_Store", "store");
    await file(right, "nested/.DS_Store", "store");

    const result = await compareFolders(left, right);
    expect(result.patterns).toEqual(DEFAULT_IGNORE);
    const paths = result.entries.map((entry) => entry.relativePath);
    expect(paths).toContain("src/a.ts");
    expect(paths.some((item) => item.includes("node_modules"))).toBe(false);
    expect(paths.some((item) => item.split("/").includes(".git"))).toBe(false);
    expect(paths.some((item) => item.endsWith(".DS_Store"))).toBe(false);
  });

  it("ignores a named directory at any depth", async () => {
    const { left, right } = await pair();
    await file(left, "pkg/node_modules/x.js");
    await file(right, "pkg/node_modules/x.js");
    await file(left, "pkg/index.js", "keep\n");
    await file(right, "pkg/index.js", "keep\n");

    const result = await compareFolders(left, right, ["node_modules"]);
    const paths = result.entries.map((entry) => entry.relativePath);
    expect(paths).toContain("pkg/index.js");
    expect(paths).not.toContain("pkg/node_modules/x.js");
    expect(paths).not.toContain("pkg/node_modules");
  });

  it("ignores star-dot-log", async () => {
    const { left, right } = await pair();
    await file(left, "a.log");
    await file(right, "a.log");
    await file(left, "sub/b.log");
    await file(right, "sub/b.log");
    await file(left, "sub/c.ts", "keep\n");
    await file(right, "sub/c.ts", "keep\n");

    const result = await compareFolders(left, right, ["*.log"]);
    const paths = result.entries.map((entry) => entry.relativePath);
    expect(paths).toEqual(["sub", "sub/c.ts"]);
  });

  it("does not treat a prefix as a directory name", () => {
    const rules = compileIgnore(["git"]);
    expect(rules.match(".git/config")).toBe(false);
    expect(rules.match("github.txt")).toBe(false);
    expect(rules.match("src/git/file.txt")).toBe(true);
  });

  it("applies every pattern", async () => {
    const { left, right } = await pair();
    await file(left, "dist/a.js");
    await file(right, "dist/a.js");
    await file(left, "x.tmp");
    await file(right, "x.tmp");
    await file(left, "src/a.ts", "keep\n");
    await file(right, "src/a.ts", "keep\n");

    const result = await compareFolders(left, right, ["dist", "*.tmp"]);
    const files = result.entries.filter((entry) => entry.type === "file").map((entry) => entry.relativePath);
    expect(files).toEqual(["src/a.ts"]);
  });

  it("keeps everything when patterns are empty", async () => {
    const { left, right } = await pair();
    await file(left, "node_modules/a.js", "keep\n");
    await file(right, "node_modules/a.js", "keep\n");

    const result = await compareFolders(left, right, []);
    expect(result.patterns).toEqual([]);
    expect(result.entries.map((entry) => entry.relativePath)).toContain("node_modules/a.js");
  });

  it("rejects an invalid ignore pattern", () => {
    expect(() => compileIgnore(["["])).toThrow(/Invalid ignore pattern/);
  });
});
