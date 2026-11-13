import { lstat, readdir, readlink } from "node:fs/promises";
import path from "node:path";

import { CompareError } from "./errors";
import { normalizeUserPath } from "./paths";
import type { IgnoreRules } from "./ignore";
import type { WalkEntry, WalkResult } from "./types";

export async function assertDirectory(input: string): Promise<string> {
  return assertKind(input, "directory");
}

export async function assertFile(input: string): Promise<string> {
  return assertKind(input, "file");
}

async function assertKind(input: string, expected: "directory" | "file"): Promise<string> {
  if (typeof input !== "string" || input.trim() === "") {
    throw new CompareError(
      expected === "directory" ? "Choose a folder path." : "Choose a file path.",
    );
  }
  const resolved = normalizeUserPath(input);
  let stat;
  try {
    stat = await lstat(resolved);
  } catch {
    throw new CompareError(`Path does not exist: ${resolved}`, 404);
  }
  if (stat.isSymbolicLink()) {
    throw new CompareError(
      `Refusing to use a symlink as a compare root: ${resolved}`,
    );
  }
  const ok = expected === "directory" ? stat.isDirectory() : stat.isFile();
  if (!ok) {
    throw new CompareError(
      expected === "directory"
        ? `Path is not a directory: ${resolved}`
        : `Path is not a file: ${resolved}`,
      400,
    );
  }
  return resolved;
}

export type WalkOptions = {
  signal?: AbortSignal;
  onVisit?: (relativePath: string) => void | Promise<void>;
};

export async function walkTree(
  root: string,
  ignore: IgnoreRules,
  options?: WalkOptions,
): Promise<WalkResult> {
  const entries = new Map<string, WalkEntry>();
  const errors = new Map<string, string>();
  await walkDirectory(root, "", entries, errors, ignore, options);
  return { entries, errors };
}

async function walkDirectory(
  absoluteDir: string,
  relativeDir: string,
  entries: Map<string, WalkEntry>,
  errors: Map<string, string>,
  ignore: IgnoreRules,
  options?: WalkOptions,
): Promise<void> {
  throwIfAborted(options?.signal);
  let dirents;
  try {
    dirents = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read directory";
    errors.set(relativeDir, message);
    return;
  }

  const ordered = [...dirents].sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const dirent of ordered) {
    throwIfAborted(options?.signal);
    if (dirent.name === "." || dirent.name === "..") continue;
    const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
    if (ignore.match(relativePath)) continue;
    const absolutePath = path.join(absoluteDir, dirent.name);
    try {
      if (dirent.isSymbolicLink()) {
        const stat = await lstat(absolutePath);
        let target = "";
        try {
          target = await readlink(absolutePath);
        } catch (error) {
          errors.set(
            relativePath,
            error instanceof Error ? error.message : "Could not read symlink",
          );
        }
        entries.set(relativePath, {
          relativePath,
          name: dirent.name,
          kind: "symlink",
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          target,
        });
        await options?.onVisit?.(relativePath);
        continue;
      }

      if (dirent.isDirectory()) {
        const stat = await lstat(absolutePath);
        entries.set(relativePath, {
          relativePath,
          name: dirent.name,
          kind: "directory",
          size: 0,
          mtimeMs: stat.mtimeMs,
        });
        await options?.onVisit?.(relativePath);
        await walkDirectory(absolutePath, relativePath, entries, errors, ignore, options);
        continue;
      }

      if (dirent.isFile()) {
        const stat = await lstat(absolutePath);
        entries.set(relativePath, {
          relativePath,
          name: dirent.name,
          kind: "file",
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
        await options?.onVisit?.(relativePath);
        continue;
      }

      const stat = await lstat(absolutePath);
      entries.set(relativePath, {
        relativePath,
        name: dirent.name,
        kind: "other",
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      await options?.onVisit?.(relativePath);
    } catch (error) {
      errors.set(
        relativePath,
        error instanceof Error ? error.message : "Could not read path",
      );
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompareError("Compare cancelled.", 499);
}

