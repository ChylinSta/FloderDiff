import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertSafeCopy, copyFileTo, copyPath, resolveInsideRoot } from "./copy";
import { CompareError } from "./errors";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("copy between sides", () => {
  it("creates a missing destination and refuses to overwrite until asked", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-copy-"));
    cleanup.push(root);
    const from = path.join(root, "left", "nested", "note.txt");
    await mkdir(path.dirname(from), { recursive: true });
    await writeFile(from, "from-left\n");
    const to = resolveInsideRoot(path.join(root, "right"), "nested/note.txt");
    const created = await copyFileTo(from, to, false);
    expect(created.overwritten).toBe(false);
    expect(await readFile(to, "utf8")).toBe("from-left\n");

    await writeFile(from, "changed\n");
    await expect(copyFileTo(from, to, false)).rejects.toBeInstanceOf(CompareError);
    await expect(copyFileTo(from, to, false)).rejects.toMatchObject({ status: 409 });
    const replaced = await copyFileTo(from, to, true);
    expect(replaced.overwritten).toBe(true);
    expect(await readFile(to, "utf8")).toBe("changed\n");
  });

  it("rejects a relative path that leaves the destination root", () => {
    expect(() => resolveInsideRoot("/tmp/right", "../outside.txt")).toThrow(/leaves the folder/);
  });

  it("copies a directory tree without deleting the source or extra destination files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-"));
    cleanup.push(root);
    const source = path.join(root, "left", "pack");
    const destination = path.join(root, "right", "pack");
    await mkdir(path.join(source, "nested"), { recursive: true });
    await mkdir(path.join(destination, "nested"), { recursive: true });
    await writeFile(path.join(source, "nested", "a.txt"), "from-source\n");
    await writeFile(path.join(source, "readme.txt"), "readme\n");
    await writeFile(path.join(destination, "keep.txt"), "keep\n");

    const created = await copyPath(source, destination, false);
    expect(created.filesCopied).toBe(2);
    expect(created.overwritten).toBe(false);
    expect(await readFile(path.join(destination, "nested", "a.txt"), "utf8")).toBe("from-source\n");
    expect(await readFile(path.join(destination, "keep.txt"), "utf8")).toBe("keep\n");
    expect(await readFile(path.join(source, "nested", "a.txt"), "utf8")).toBe("from-source\n");
  });

  it("does not write a directory when overwrite is required and then replaces files when allowed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-overwrite-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    await mkdir(source);
    await mkdir(destination);
    await writeFile(path.join(source, "a.txt"), "new\n");
    await writeFile(path.join(destination, "a.txt"), "old\n");

    await expect(copyPath(source, destination, false)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path.join(destination, "a.txt"), "utf8")).toBe("old\n");

    const replaced = await copyPath(source, destination, true);
    expect(replaced.overwritten).toBe(true);
    expect(await readFile(path.join(destination, "a.txt"), "utf8")).toBe("new\n");
    expect(await readFile(path.join(source, "a.txt"), "utf8")).toBe("new\n");
  });

  it("skips symlinks inside a copied folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-link-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const outside = path.join(root, "secret.txt");
    await mkdir(source);
    await writeFile(path.join(source, "real.txt"), "real\n");
    await writeFile(outside, "secret\n");
    try {
      await symlink(outside, path.join(source, "link.txt"));
    } catch {
      expect(process.platform).toBe("win32");
      return;
    }
    const copied = await copyPath(source, path.join(root, "right"), false);
    expect(copied.filesCopied).toBe(1);
    expect(copied.skippedSymlinks).toBe(1);
    await expect(readFile(path.join(root, "right", "link.txt"))).rejects.toThrow();
    expect(await readFile(path.join(root, "right", "real.txt"), "utf8")).toBe("real\n");
  });

  it("refuses to copy a folder into itself or onto a drive root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-danger-"));
    cleanup.push(root);
    await mkdir(path.join(root, "nested"));
    await expect(copyPath(root, path.join(root, "nested"), true)).rejects.toThrow(/into itself/);
    expect(() => assertSafeCopy(path.join(root, "nested"), path.parse(root).root)).toThrow(/drive root/);
  });
});
