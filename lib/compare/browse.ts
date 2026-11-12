import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CompareError } from "./errors";
import { normalizeUserPath } from "./paths";
import type { BrowseResult, NodeKind } from "./types";

export async function browseDirectory(input: string | null | undefined): Promise<BrowseResult> {
  const roots = platformRoots();
  const requested = input?.trim() ? normalizeUserPath(input) : os.homedir();
  let info;
  try {
    info = await stat(requested);
  } catch {
    throw new CompareError(`Path does not exist: ${requested}`, 404);
  }
  if (!info.isDirectory()) {
    throw new CompareError(`Path is not a directory: ${requested}`, 400);
  }

  let dirents;
  try {
    dirents = await readdir(requested, { withFileTypes: true });
  } catch (error) {
    throw new CompareError(
      error instanceof Error ? error.message : "Could not read directory",
      400,
    );
  }

  const entries = dirents
    .filter((dirent) => dirent.name !== "." && dirent.name !== "..")
    .map((dirent) => ({
      name: dirent.name,
      kind: kindFromDirent(dirent),
    }))
    .sort((a, b) => {
      if (a.kind === "directory" && b.kind !== "directory") return -1;
      if (b.kind === "directory" && a.kind !== "directory") return 1;
      return a.name.localeCompare(b.name, "en");
    });

  const parent = path.dirname(requested);
  return {
    path: requested,
    parent: parent === requested ? null : parent,
    roots,
    entries,
  };
}

function kindFromDirent(dirent: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }): NodeKind {
  if (dirent.isSymbolicLink()) return "symlink";
  if (dirent.isDirectory()) return "directory";
  if (dirent.isFile()) return "file";
  return "other";
}

export function platformRoots(options?: {
  platform?: NodeJS.Platform;
  exists?: (candidate: string) => boolean;
}): string[] {
  const platform = options?.platform ?? process.platform;
  const exists = options?.exists ?? existsSync;
  if (platform === "win32") {
    const roots: string[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      const root = `${letter}:\\`;
      if (exists(root) || exists(`${letter}:/`)) roots.push(root);
    }
    return roots.length > 0 ? roots : ["C:\\"];
  }
  return ["/"];
}
