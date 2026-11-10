import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fileExitCode, folderExitCode } from "./exit-code";
import { compareFolders } from "./folder";
import { diffFiles } from "./text-diff";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("cli/folderdiff.ts"), ...args],
    { encoding: "utf8" },
  );
}

describe("CLI exit codes", () => {
  it("uses 0 for identical folder and file results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-exit-"));
    cleanup.push(root);
    const left = path.join(root, "left");
    const right = path.join(root, "right");
    await mkdir(left);
    await mkdir(right);
    await writeFile(path.join(left, "a.txt"), "same\n");
    await writeFile(path.join(right, "a.txt"), "same\n");
    expect(folderExitCode(await compareFolders(left, right, []))).toBe(0);
    expect(fileExitCode(await diffFiles(path.join(left, "a.txt"), path.join(right, "a.txt")))).toBe(0);

    const dirs = runCli(["dirs", left, right, "--no-ignore"]);
    const files = runCli(["files", path.join(left, "a.txt"), path.join(right, "a.txt")]);
    expect(dirs.status).toBe(0);
    expect(files.status).toBe(0);
  });

  it("uses 2 when folders or files differ and 1 when a path is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-exit-"));
    cleanup.push(root);
    const left = path.join(root, "left");
    const right = path.join(root, "right");
    await mkdir(left);
    await mkdir(right);
    await writeFile(path.join(left, "a.txt"), "one\n");
    await writeFile(path.join(right, "a.txt"), "two\n");
    expect(folderExitCode(await compareFolders(left, right, []))).toBe(2);
    expect(fileExitCode(await diffFiles(path.join(left, "a.txt"), path.join(right, "a.txt")))).toBe(2);

    const dirs = runCli(["dirs", left, right, "--no-ignore"]);
    const files = runCli(["files", path.join(left, "a.txt"), path.join(right, "a.txt")]);
    const missing = runCli(["files", path.join(left, "missing.txt"), path.join(right, "a.txt")]);
    const usage = runCli(["files", left]);
    expect(dirs.status).toBe(2);
    expect(files.status).toBe(2);
    expect(missing.status).toBe(1);
    expect(usage.status).toBe(1);
  });
});
