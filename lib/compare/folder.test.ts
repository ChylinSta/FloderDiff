import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compareFolders } from "./folder";
import type { CompareProgress } from "./types";
import type { CompareEntry } from "./types";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function pair() {
  const root = await mkdtemp(path.join(tmpdir(), "folderdiff-folder-"));
  cleanup.push(root);
  const left = path.join(root, "left");
  const right = path.join(root, "right");
  await mkdir(left);
  await mkdir(right);
  return { root, left, right };
}

async function file(root: string, relativePath: string, body: string | Buffer) {
  const absolute = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
}

function byPath(entries: CompareEntry[], relativePath: string) {
  const found = entries.find((entry) => entry.relativePath === relativePath);
  expect(found, relativePath).toBeDefined();
  return found!;
}

describe("folder walk classification", () => {
  it("classifies identical files as same", async () => {
    const { left, right } = await pair();
    await file(left, "a.txt", "hello");
    await file(right, "a.txt", "hello");
    const result = await compareFolders(left, right, []);
    expect(byPath(result.entries, "a.txt").status).toBe("same");
    expect(result.summary.same).toBeGreaterThanOrEqual(1);
  });

  it("classifies changed files as different", async () => {
    const { left, right } = await pair();
    await file(left, "a.txt", "hello");
    await file(right, "a.txt", "hello!");
    const result = await compareFolders(left, right, []);
    expect(byPath(result.entries, "a.txt").status).toBe("different");
  });

  it("classifies files that exist only on the left", async () => {
    const { left, right } = await pair();
    await file(left, "only-left.txt", "left");
    const result = await compareFolders(left, right, []);
    const entry = byPath(result.entries, "only-left.txt");
    expect(entry.status).toBe("left-only");
    expect(entry.right).toBeUndefined();
    expect(entry.left?.size).toBeGreaterThan(0);
  });

  it("classifies files that exist only on the right", async () => {
    const { left, right } = await pair();
    await file(right, "only-right.txt", "right");
    const result = await compareFolders(left, right, []);
    const entry = byPath(result.entries, "only-right.txt");
    expect(entry.status).toBe("right-only");
    expect(entry.left).toBeUndefined();
  });

  it("classifies nested files by relative path", async () => {
    const { left, right } = await pair();
    await file(left, "sub/n.txt", "x");
    await file(right, "sub/n.txt", "x");
    const result = await compareFolders(left, right, []);
    expect(byPath(result.entries, "sub/n.txt").status).toBe("same");
  });

  it("flags a file vs directory type mismatch", async () => {
    const { left, right } = await pair();
    await file(left, "box", "I am a file");
    await mkdir(path.join(right, "box"));
    await file(right, "box/child.txt", "inside");
    const result = await compareFolders(left, right, []);
    expect(byPath(result.entries, "box").status).toBe("type-mismatch");
    expect(byPath(result.entries, "box/child.txt").status).toBe("right-only");
    expect(result.summary["type-mismatch"]).toBe(1);
  });

  it("rolls directory status up from children", async () => {
    const { left, right } = await pair();
    await file(left, "sub/a.txt", "same");
    await file(right, "sub/a.txt", "same");
    await file(left, "sub/b.txt", "one");
    await file(right, "sub/b.txt", "two");
    await file(left, "ok/c.txt", "c");
    await file(right, "ok/c.txt", "c");
    const result = await compareFolders(left, right, []);
    expect(byPath(result.entries, "sub").status).toBe("different");
    expect(byPath(result.entries, "ok").status).toBe("same");
  });

  it("counts files, not directories, in the summary", async () => {
    const { left, right } = await pair();
    await file(left, "dir/a.txt", "a");
    await file(right, "dir/a.txt", "a");
    await file(left, "dir/b.txt", "b");
    await file(right, "dir/b.txt", "b");
    const result = await compareFolders(left, right, []);
    expect(result.summary.same).toBe(2);
    expect(byPath(result.entries, "dir").type).toBe("directory");
  });

  it("does not follow symlinks or walk through them", async () => {
    const { root, left, right } = await pair();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "hidden.txt"), "secret");
    await file(left, "a.txt", "hello");
    await file(right, "a.txt", "hello");
    try {
      await symlink(path.join(outside, "hidden.txt"), path.join(left, "link"));
      await symlink(path.join(left, "a.txt"), path.join(right, "link"));
      await symlink(outside, path.join(left, "dirlink"));
    } catch {
      expect(process.platform).toBe("win32");
      return;
    }

    const result = await compareFolders(left, right, []);
    const paths = result.entries.map((entry) => entry.relativePath);
    expect(paths).not.toContain("hidden.txt");
    expect(paths.some((item) => item.includes("outside"))).toBe(false);
    const link = byPath(result.entries, "link");
    expect(link.type).toBe("symlink");
    expect(link.status).toBe("different");
    expect(byPath(result.entries, "dirlink").type).toBe("symlink");
    expect(paths.some((item) => item.startsWith("dirlink/"))).toBe(false);
  });

  it("fails when a root is missing", async () => {
    const { right } = await pair();
    await expect(compareFolders(path.join(right, "missing"), right, [])).rejects.toThrow(
      /does not exist/,
    );
  });

  it("hashes binary files without reading them as strings", async () => {
    const { left, right } = await pair();
    const same = Buffer.from([0, 1, 2, 255]);
    await file(left, "same.bin", same);
    await file(right, "same.bin", Buffer.from(same));
    await file(left, "diff.bin", Buffer.from([0, 1, 2, 3]));
    await file(right, "diff.bin", Buffer.from([0, 1, 2, 4]));
    const result = await compareFolders(left, right, []);
    expect(byPath(result.entries, "same.bin").status).toBe("same");
    expect(byPath(result.entries, "diff.bin").status).toBe("different");
    expect(byPath(result.entries, "same.bin").leftHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records an unreadable directory instead of failing the compare", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const { left, right } = await pair();
    const lockedLeft = path.join(left, "locked");
    const lockedRight = path.join(right, "locked");
    await mkdir(lockedLeft);
    await mkdir(lockedRight);
    await chmod(lockedLeft, 0);
    await chmod(lockedRight, 0);
    try {
      const result = await compareFolders(left, right, []);
      const entry = byPath(result.entries, "locked");
      expect(entry.error).toBeTruthy();
      expect(result.summary.errors).toBeGreaterThanOrEqual(1);
    } finally {
      await chmod(lockedLeft, 0o700);
      await chmod(lockedRight, 0o700);
    }
  });

  it("reports walk and hash progress and can cancel", async () => {
    const { left, right } = await pair();
    await file(left, "a.txt", "one");
    await file(right, "a.txt", "two");
    await file(left, "b.txt", "same");
    await file(right, "b.txt", "same");
    const events: CompareProgress[] = [];
    await compareFolders(left, right, [], {
      onProgress: (progress) => {
        events.push(progress);
      },
    });
    expect(events.some((event) => event.phase === "walk" && event.done > 0)).toBe(true);
    const finished = events.filter((event) => event.phase === "hash" && event.done === event.total);
    expect(finished.at(-1)?.total).toBe(2);

    const controller = new AbortController();
    await expect(
      compareFolders(left, right, [], {
        signal: controller.signal,
        onProgress: () => {
          controller.abort();
        },
      }),
    ).rejects.toThrow(/cancelled/i);
  });

  it("fixture trees match the documented categories", async () => {
    const left = path.resolve("fixtures/left");
    const right = path.resolve("fixtures/right");
    const result = await compareFolders(left, right);
    const status = (relativePath: string) => byPath(result.entries, relativePath).status;

    expect(status("README.md")).toBe("different");
    expect(status("docs/note.txt")).toBe("same");
    expect(status("src/app.ts")).toBe("same");
    expect(status("src/util.ts")).toBe("different");
    expect(status("src/only-left.ts")).toBe("left-only");
    expect(status("src/only-right.ts")).toBe("right-only");
    expect(status("assets/logo.bin")).toBe("different");
    expect(status("nested/extra.txt")).toBe("right-only");
    expect(status("notes.log")).toBe("different");
    expect(status("src")).toBe("different");
    expect(status("docs")).toBe("same");

    const paths = result.entries.map((entry) => entry.relativePath);
    expect(paths.some((item) => item.includes("node_modules"))).toBe(false);
    expect(paths.some((item) => item.endsWith(".DS_Store"))).toBe(false);

    const withLogsIgnored = await compareFolders(left, right, [...result.patterns, "*.log"]);
    expect(withLogsIgnored.entries.map((entry) => entry.relativePath)).not.toContain("notes.log");
  });
});
