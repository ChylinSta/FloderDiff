import { copyFile, lstat, mkdir, unlink } from "node:fs/promises";
import path from "node:path";

import { CompareError } from "./errors";

export async function copyFileTo(
  fromInput: string,
  toInput: string,
  overwrite: boolean,
): Promise<{ to: string; overwritten: boolean }> {
  if (typeof fromInput !== "string" || fromInput.trim() === "" || typeof toInput !== "string" || toInput.trim() === "") {
    throw new CompareError("Choose a source file and a destination.");
  }
  const from = path.resolve(fromInput);
  const to = path.resolve(toInput);
  if (from === to) throw new CompareError("Source and destination are the same file.");

  let source;
  try {
    source = await lstat(from);
  } catch {
    throw new CompareError(`Path does not exist: ${from}`, 404);
  }
  if (source.isSymbolicLink() || !source.isFile()) {
    throw new CompareError("Only regular files can be copied.", 400);
  }

  const overwritten = await prepareDestination(to, overwrite);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
  return { to, overwritten };
}

export function resolveInsideRoot(rootInput: string, relativePath: string): string {
  if (typeof rootInput !== "string" || rootInput.trim() === "") {
    throw new CompareError("Choose the destination folder.");
  }
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new CompareError("Choose a file inside the folder.");
  }
  const parts = relativePath.split("/").filter((part) => part.length > 0);
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

async function prepareDestination(to: string, overwrite: boolean): Promise<boolean> {
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
