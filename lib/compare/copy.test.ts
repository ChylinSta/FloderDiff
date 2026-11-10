import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { copyFileTo, resolveInsideRoot } from "./copy";
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
});
