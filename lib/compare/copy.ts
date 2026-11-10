import { copyFile, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import { CompareError } from "./errors";

export type CopyResult = {
  to: string;
  overwritten: boolean;
  filesCopied: number;
  skippedSymlinks: number;
  skippedSpecial: number;
};

export async function copyPath(fromInput: string, toInput: string, overwrite: boolean): Promise<CopyResult> {
  const from = resolveCopyInput(fromInput, "source");
  const to = resolveCopyInput(toInput, "destination");
  assertSafeCopy(from, to);
  let source;
  try {
    source = await lstat(from);
  } catch {
    throw new CompareError(`Path does not exist: ${from}`, 404);
  }
  if (source.isSymbolicLink()) {
    throw new CompareError("Refusing to copy a symlink. FolderDiff does not follow links.", 400);
  }
  if (source.isDirectory()) return copyTree(from, to, overwrite);
  if (source.isFile()) {
    const file = await copyFileTo(from, to, overwrite);
    return { ...file, filesCopied: 1, skippedSymlinks: 0, skippedSpecial: 0 };
  }
  throw new CompareError("That path is not a file or folder.", 400);
}

export async function copyFileTo(
  fromInput: string,
  toInput: string,
  overwrite: boolean,
): Promise<{ to: string; overwritten: boolean }> {
  const from = resolveCopyInput(fromInput, "source");
  const to = resolveCopyInput(toInput, "destination");
  assertSafeCopy(from, to);

  let source;
  try {
    source = await lstat(from);
  } catch {
    throw new CompareError(`Path does not exist: ${from}`, 404);
  }
  if (source.isSymbolicLink() || !source.isFile()) {
    throw new CompareError("Only regular files can be copied.", 400);
  }

  const overwritten = await prepareFileDestination(to, overwrite);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
  return { to, overwritten };
}

export async function copyTree(from: string, to: string, overwrite: boolean): Promise<CopyResult> {
  assertSafeCopy(from, to);
  let destinationStat: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    destinationStat = await lstat(to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new CompareError(error instanceof Error ? error.message : "Could not inspect the destination.", 400);
    }
  }
  if (destinationStat?.isSymbolicLink()) {
    throw new CompareError("Refusing to copy onto a symlink.", 400);
  }
  if (destinationStat && !destinationStat.isDirectory()) {
    throw new CompareError("The destination is a file, not a folder.", 400);
  }

  const plan: Array<{ from: string; to: string; exists: boolean }> = [];
  const directories = [to];
  const skipped = { symlinks: 0, special: 0 };
  await planTree(from, to, plan, directories, skipped);
  const overwritten = plan.some((item) => item.exists);
  if (overwritten && !overwrite) {
    throw new CompareError("The destination already contains files from this folder.", 409);
  }

  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
  }
  for (const item of plan) {
    await mkdir(path.dirname(item.to), { recursive: true });
    if (item.exists) {
      const existing = await lstat(item.to);
      if (existing.isSymbolicLink()) await unlink(item.to);
    }
    await copyFile(item.from, item.to);
  }
  return {
    to,
    overwritten,
    filesCopied: plan.length,
    skippedSymlinks: skipped.symlinks,
    skippedSpecial: skipped.special,
  };
}

async function planTree(
  fromDir: string,
  toDir: string,
  plan: Array<{ from: string; to: string; exists: boolean }>,
  directories: string[],
  skipped: { symlinks: number; special: number },
): Promise<void> {
  const dirents = await readdir(fromDir, { withFileTypes: true });
  for (const dirent of dirents) {
    const source = path.join(fromDir, dirent.name);
    const destination = path.join(toDir, dirent.name);
    if (dirent.isSymbolicLink()) {
      skipped.symlinks += 1;
      continue;
    }
    if (dirent.isDirectory()) {
      directories.push(destination);
      await planTree(source, destination, plan, directories, skipped);
      continue;
    }
    if (!dirent.isFile()) {
      skipped.special += 1;
      continue;
    }
    let exists = false;
    try {
      const current = await lstat(destination);
      if (current.isDirectory()) {
        throw new CompareError(`A folder is in the way of ${destination}.`, 400);
      }
      exists = true;
    } catch (error) {
      if (error instanceof CompareError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CompareError(error instanceof Error ? error.message : "Could not inspect the destination.", 400);
      }
    }
    plan.push({ from: source, to: destination, exists });
  }
}

export function resolveInsideRoot(rootInput: string, relativePath: string): string {
  if (typeof rootInput !== "string" || rootInput.trim() === "") {
    throw new CompareError("Choose the destination folder.");
  }
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new CompareError("Choose a path inside the folder.");
  }
  const parts = relativePath.split(/[/\\]/).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new CompareError("That path leaves the folder you are comparing.");
  }
  const root = path.resolve(rootInput);
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CompareError("That path leaves the folder you are comparing.");
  }
  return target;
}

export function assertSafeCopy(fromInput: string, toInput: string): void {
  const source = path.resolve(fromInput);
  const destination = path.resolve(toInput);
  if (isFilesystemRoot(source)) throw new CompareError("Refusing to copy a drive root.");
  if (isFilesystemRoot(destination)) throw new CompareError("Refusing to copy onto a drive root.");
  if (source === destination) throw new CompareError("Source and destination are the same path.");
  if (isInside(source, destination) || isInside(destination, source)) {
    throw new CompareError("Refusing to copy a folder into itself.");
  }
}

function resolveCopyInput(input: string, role: "source" | "destination"): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new CompareError(role === "source" ? "Choose a source file and a destination." : "Choose a source file and a destination.");
  }
  return path.resolve(input);
}

async function prepareFileDestination(to: string, overwrite: boolean): Promise<boolean> {
  let dest;
  try {
    dest = await lstat(to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw new CompareError(error instanceof Error ? error.message : "Could not inspect the destination.", 400);
  }
  if (dest.isDirectory()) throw new CompareError("The destination is a directory.", 400);
  if (!overwrite) throw new CompareError("The destination already exists.", 409);
  if (dest.isSymbolicLink()) await unlink(to);
  return true;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isFilesystemRoot(target: string): boolean {
  return path.resolve(target) === path.parse(target).root;
}
