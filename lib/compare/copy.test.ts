import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertSafeCopy, CopyCancelledError, copyFileTo, copyPath, previewCopy, resolveInsideRoot } from "./copy";
import type { CopyProgress } from "./copy";
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

  it("reports copy progress and can cancel before every file is written", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-progress-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    await mkdir(source);
    await writeFile(path.join(source, "a.txt"), "a\n");
    await writeFile(path.join(source, "b.txt"), "b\n");
    await writeFile(path.join(source, "c.txt"), "c\n");
    const events: CopyProgress[] = [];
    await copyPath(source, destination, {
      overwrite: true,
      onProgress: (progress) => {
        events.push({ ...progress });
      },
    });
    const copies = events.filter((event) => event.phase === "copy");
    expect(copies.at(-1)).toMatchObject({ done: 3, total: 3 });
    expect(copies.some((event) => event.path === "a.txt" || event.path === "b.txt" || event.path === "c.txt")).toBe(true);

    const again = path.join(root, "again");
    const controller = new AbortController();
    await expect(
      copyPath(source, again, {
        overwrite: true,
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === "copy" && progress.done === 1) controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(CopyCancelledError);
    await expect(lstat(again)).rejects.toThrow();
  });

  it("rolls back files this copy wrote and leaves pre-existing files alone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-rollback-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    await mkdir(source);
    await mkdir(destination);
    await writeFile(path.join(source, "a.txt"), "new\n");
    await writeFile(path.join(source, "b.txt"), "b\n");
    await writeFile(path.join(destination, "a.txt"), "old\n");
    await writeFile(path.join(destination, "keep.txt"), "keep\n");
    const controller = new AbortController();
    const error = await copyPath(source, destination, {
      overwrite: true,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === "copy" && progress.done === 1) controller.abort();
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CopyCancelledError);
    expect((error as CopyCancelledError).report.partial).toEqual([]);
    expect((error as CopyCancelledError).message).toMatch(/left in place/);
    expect(await readFile(path.join(destination, "a.txt"), "utf8")).toBe("old\n");
    expect(await readFile(path.join(destination, "keep.txt"), "utf8")).toBe("keep\n");
    await expect(readFile(path.join(destination, "b.txt"))).rejects.toThrow();
  });

  it("puts back a destination-only file when a mirror copy is cancelled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-rollback-mirror-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    await mkdir(source);
    await mkdir(destination);
    await writeFile(path.join(source, "a.txt"), "new\n");
    await writeFile(path.join(destination, "a.txt"), "old\n");
    await writeFile(path.join(destination, "extra.txt"), "extra\n");
    const controller = new AbortController();
    const error = await copyPath(source, destination, {
      overwrite: true,
      mirror: true,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === "delete" && progress.done === 1) controller.abort();
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CopyCancelledError);
    expect((error as CopyCancelledError).report.partial).toEqual([]);
    expect(await readFile(path.join(destination, "a.txt"), "utf8")).toBe("old\n");
    expect(await readFile(path.join(destination, "extra.txt"), "utf8")).toBe("extra\n");
  });

  it("names paths it could not roll back", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-partial-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    await mkdir(source);
    await writeFile(path.join(source, "a.txt"), "a\n");
    const controller = new AbortController();
    let thrown: unknown;
    try {
      await copyPath(source, destination, {
        overwrite: true,
        signal: controller.signal,
        onProgress: async (progress) => {
          if (progress.phase === "copy" && progress.done === 1) {
            await chmod(destination, 0o555);
            controller.abort();
          }
        },
      });
    } catch (error) {
      thrown = error;
    } finally {
      await chmod(destination, 0o755).catch(() => undefined);
    }
    expect(thrown).toBeInstanceOf(CopyCancelledError);
    const error = thrown as CopyCancelledError;
    expect(error.report.partial.length).toBeGreaterThan(0);
    expect(error.message).toMatch(/Partial copy/);
    expect(await readFile(path.join(destination, "a.txt"), "utf8")).toBe("a\n");
  });

  it("removes destination-only files only when mirror is requested", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-mirror-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    await mkdir(path.join(source, "keep"), { recursive: true });
    await mkdir(path.join(destination, "keep"), { recursive: true });
    await mkdir(path.join(destination, "only"), { recursive: true });
    await writeFile(path.join(source, "keep", "a.txt"), "a\n");
    await writeFile(path.join(destination, "keep", "a.txt"), "old\n");
    await writeFile(path.join(destination, "only", "extra.txt"), "extra\n");
    await writeFile(path.join(destination, "keep", "stay-without-mirror.txt"), "stay\n");

    const preview = await previewCopy(source, destination, { overwrite: true, mirror: true });
    expect(preview.deletions.map((item) => item.relativePath).sort()).toEqual([
      "keep/stay-without-mirror.txt",
      "only",
      "only/extra.txt",
    ]);
    expect(preview.filesToOverwrite).toBe(1);

    await copyPath(source, destination, { overwrite: true, mirror: false });
    expect(await readFile(path.join(destination, "only", "extra.txt"), "utf8")).toBe("extra\n");

    const mirrored = await copyPath(source, destination, { overwrite: true, mirror: true });
    expect(mirrored.deleted).toBe(3);
    expect(await readFile(path.join(destination, "keep", "a.txt"), "utf8")).toBe("a\n");
    expect(await readFile(path.join(source, "keep", "a.txt"), "utf8")).toBe("a\n");
    await expect(readFile(path.join(destination, "only", "extra.txt"))).rejects.toThrow();
  });

  it("does not follow a destination symlink when mirroring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-mirror-link-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    const outside = path.join(root, "secret.txt");
    await mkdir(source);
    await mkdir(destination);
    await writeFile(path.join(source, "a.txt"), "a\n");
    await writeFile(outside, "secret\n");
    try {
      await symlink(outside, path.join(destination, "escape"));
    } catch {
      expect(process.platform).toBe("win32");
      return;
    }
    await copyPath(source, destination, { overwrite: true, mirror: true, sourceRoot: source, destRoot: destination });
    await expect(lstat(path.join(destination, "escape"))).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("secret\n");
  });

  it("recreates an inside symlink and skips one that leaves the compare root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-relink-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    const outside = path.join(root, "outside.txt");
    await mkdir(source);
    await writeFile(path.join(source, "real.txt"), "real\n");
    await writeFile(outside, "out\n");
    try {
      await symlink("real.txt", path.join(source, "inside"));
      await symlink(outside, path.join(source, "outside"));
    } catch {
      expect(process.platform).toBe("win32");
      return;
    }
    const copied = await copyPath(source, destination, {
      overwrite: true,
      copySymlinks: true,
      sourceRoot: source,
      destRoot: destination,
    });
    expect(copied.symlinksCopied).toBe(1);
    expect(copied.skippedSymlinks).toBe(1);
    expect(await readlink(path.join(destination, "inside"))).toBe("real.txt");
    await expect(lstat(path.join(destination, "outside"))).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("out\n");
  });

  it("refuses to copy a folder into itself or onto a drive root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-tree-danger-"));
    cleanup.push(root);
    await mkdir(path.join(root, "nested"));
    await expect(copyPath(root, path.join(root, "nested"), true)).rejects.toThrow(/into itself/);
    expect(() => assertSafeCopy(path.join(root, "nested"), path.parse(root).root)).toThrow(/drive root/);
    expect(() => assertSafeCopy("C:\\data\\src", "C:\\")).toThrow(/drive root/);
    expect(() => assertSafeCopy("D:\\data", "D:/data")).toThrow(/same path/);
    expect(() => assertSafeCopy("D:\\data", "D:\\data\\child")).toThrow(/into itself/);
    expect(resolveInsideRoot("C:/data", "nested/file.txt")).toBe("C:\\data\\nested\\file.txt");
  });
});
