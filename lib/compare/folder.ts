import path from "node:path";

import { CompareError } from "./errors";
import { hashFile } from "./hash";
import { compileIgnore } from "./ignore";
import type {
  CompareEntry,
  FolderCompareResult,
  FolderSummary,
  SideStat,
  WalkEntry,
} from "./types";
import { assertDirectory, walkTree } from "./walk";

export async function compareFolders(
  leftInput: string,
  rightInput: string,
  patterns?: string[],
): Promise<FolderCompareResult> {
  const ignore = compileIgnore(patterns);
  const leftRoot = await assertDirectory(leftInput);
  const rightRoot = await assertDirectory(rightInput);
  const [leftWalk, rightWalk] = await Promise.all([
    walkTree(leftRoot, ignore),
    walkTree(rightRoot, ignore),
  ]);
  const rootError = leftWalk.errors.get("") ?? rightWalk.errors.get("");
  if (rootError) {
    throw new CompareError(rootError, 400);
  }

  const paths = new Set<string>([
    ...leftWalk.entries.keys(),
    ...rightWalk.entries.keys(),
    ...leftWalk.errors.keys(),
    ...rightWalk.errors.keys(),
  ]);
  paths.delete("");

  const entries: CompareEntry[] = [];
  for (const relativePath of paths) {
    const left = leftWalk.entries.get(relativePath);
    const right = rightWalk.entries.get(relativePath);
    const error = joinErrors(
      leftWalk.errors.get(relativePath),
      rightWalk.errors.get(relativePath),
    );
    entries.push(
      await classifyPair({
        relativePath,
        left,
        right,
        leftRoot,
        rightRoot,
        error,
      }),
    );
  }

  rollupDirectories(entries);
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));

  return {
    leftRoot,
    rightRoot,
    patterns: ignore.patterns,
    summary: summarize(entries),
    entries,
  };
}

async function classifyPair(input: {
  relativePath: string;
  left?: WalkEntry;
  right?: WalkEntry;
  leftRoot: string;
  rightRoot: string;
  error?: string;
}): Promise<CompareEntry> {
  const { relativePath, left, right, leftRoot, rightRoot, error } = input;
  const name = path.posix.basename(relativePath);
  const base: CompareEntry = {
    relativePath,
    name,
    type: left?.kind ?? right?.kind ?? "directory",
    status: "different",
    ...(left ? { left: toStat(left), leftPath: path.join(leftRoot, ...relativePath.split("/")) } : {}),
    ...(right
      ? { right: toStat(right), rightPath: path.join(rightRoot, ...relativePath.split("/")) }
      : {}),
    ...(error ? { error } : {}),
  };

  if (left && !right) {
    base.status = "left-only";
    if (left.kind === "symlink") base.leftTarget = left.target;
    return base;
  }
  if (right && !left) {
    base.status = "right-only";
    if (right.kind === "symlink") base.rightTarget = right.target;
    return base;
  }
  if (!left || !right) {
    base.status = "different";
    base.type = "directory";
    return base;
  }

  base.type = left.kind === right.kind ? left.kind : left.kind;
  if (left.kind !== right.kind) {
    base.status = "type-mismatch";
    return base;
  }

  if (left.kind === "directory") {
    base.status = "same";
    return base;
  }

  if (left.kind === "symlink" && right.kind === "symlink") {
    base.leftTarget = left.target ?? "";
    base.rightTarget = right.target ?? "";
    base.status = base.leftTarget === base.rightTarget ? "same" : "different";
    return base;
  }

  if (left.kind === "file" && right.kind === "file") {
    try {
      const [leftHash, rightHash] = await Promise.all([
        hashFile(base.leftPath!),
        hashFile(base.rightPath!),
      ]);
      base.leftHash = leftHash;
      base.rightHash = rightHash;
      base.status = leftHash === rightHash ? "same" : "different";
    } catch (error) {
      base.status = "different";
      base.error = joinErrors(
        base.error,
        error instanceof Error ? error.message : "Could not hash file",
      );
    }
    return base;
  }

  base.status = "different";
  return base;
}

function rollupDirectories(entries: CompareEntry[]): void {
  const directories = entries
    .filter(
      (entry) =>
        entry.type === "directory" &&
        entry.left &&
        entry.right &&
        entry.status !== "type-mismatch",
    )
    .sort(
      (a, b) =>
        b.relativePath.split("/").length - a.relativePath.split("/").length,
    );

  for (const directory of directories) {
    const prefix = `${directory.relativePath}/`;
    const descendants = entries.filter((entry) => entry.relativePath.startsWith(prefix));
    const troubled =
      Boolean(directory.error) ||
      descendants.some((entry) => Boolean(entry.error) || entry.status !== "same");
    directory.status = troubled ? "different" : "same";
  }
}

function summarize(entries: CompareEntry[]): FolderSummary {
  const summary: FolderSummary = {
    same: 0,
    different: 0,
    "left-only": 0,
    "right-only": 0,
    "type-mismatch": 0,
    errors: 0,
  };
  for (const entry of entries) {
    if (entry.error) {
      summary.errors += 1;
      continue;
    }
    if (entry.type === "directory" && entry.status !== "type-mismatch") continue;
    summary[entry.status] += 1;
  }
  return summary;
}

function toStat(entry: WalkEntry): SideStat {
  return { kind: entry.kind, size: entry.size, mtimeMs: entry.mtimeMs };
}

function joinErrors(left?: string, right?: string): string | undefined {
  const parts = [left, right].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" | ") : undefined;
}

