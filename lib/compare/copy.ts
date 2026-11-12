import { copyFile, lstat, mkdir, readdir, rmdir, symlink, unlink, readlink } from "node:fs/promises";
import path from "node:path";

import { CompareError } from "./errors";

export type CopyProgress = {
  phase: "plan" | "copy" | "delete";
  done: number;
  total: number;
  path?: string;
};

export type CopyOptions = {
  overwrite?: boolean;
  /** Remove files and folders that exist only on the destination. Default false. */
  mirror?: boolean;
  /** Recreate symlinks whose targets stay inside the compare roots. Default false. */
  copySymlinks?: boolean;
  sourceRoot?: string;
  destRoot?: string;
  signal?: AbortSignal;
  onProgress?: (progress: CopyProgress) => void | Promise<void>;
};

export type SkippedLink = { path: string; reason: string };

export type CopyDeletion = {
  relativePath: string;
  kind: "file" | "directory" | "symlink";
};

export type CopyPlanSummary = {
  filesToCopy: number;
  filesToOverwrite: number;
  symlinksToCopy: number;
  skippedSymlinks: SkippedLink[];
  skippedSpecial: number;
  deletions: CopyDeletion[];
};

export type CopyResult = {
  to: string;
  overwritten: boolean;
  filesCopied: number;
  skippedSymlinks: number;
  skippedSpecial: number;
  symlinksCopied: number;
  deleted: number;
};

type PlannedFile = { from: string; to: string; relativePath: string; exists: boolean };
type PlannedLink = { to: string; relativePath: string; target: string; exists: boolean };
type PlannedDelete = { absolute: string; relativePath: string; kind: CopyDeletion["kind"] };

export async function previewCopy(
  fromInput: string,
  toInput: string,
  options: CopyOptions = {},
): Promise<CopyPlanSummary> {
  const from = resolveCopyInput(fromInput);
  const to = resolveCopyInput(toInput);
  assertSafeCopy(from, to);
  const source = await lstat(from).catch(() => {
    throw new CompareError(`Path does not exist: ${from}`, 404);
  });
  if (source.isSymbolicLink()) {
    throw new CompareError("Refusing to copy a symlink. FolderDiff does not follow links.", 400);
  }
  if (source.isFile()) {
    let exists = false;
    try {
      const dest = await lstat(to);
      if (dest.isDirectory()) throw new CompareError("The destination is a directory.", 400);
      exists = true;
    } catch (error) {
      if (error instanceof CompareError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CompareError(error instanceof Error ? error.message : "Could not inspect the destination.", 400);
      }
    }
    return {
      filesToCopy: 1,
      filesToOverwrite: exists ? 1 : 0,
      symlinksToCopy: 0,
      skippedSymlinks: [],
      skippedSpecial: 0,
      deletions: [],
    };
  }
  if (!source.isDirectory()) throw new CompareError("That path is not a file or folder.", 400);
  const plan = await buildTreePlan(from, to, options);
  return summarize(plan);
}

export async function copyPath(
  fromInput: string,
  toInput: string,
  overwriteOrOptions: boolean | CopyOptions = false,
): Promise<CopyResult> {
  const options = normalizeOptions(overwriteOrOptions);
  const from = resolveCopyInput(fromInput);
  const to = resolveCopyInput(toInput);
  assertSafeCopy(from, to);
  throwIfAborted(options.signal);
  let source;
  try {
    source = await lstat(from);
  } catch {
    throw new CompareError(`Path does not exist: ${from}`, 404);
  }
  if (source.isSymbolicLink()) {
    throw new CompareError("Refusing to copy a symlink. FolderDiff does not follow links.", 400);
  }
  if (source.isDirectory()) return writeTree(from, to, options);
  if (source.isFile()) {
    await options.onProgress?.({ phase: "copy", done: 0, total: 1, path: path.basename(from) });
    throwIfAborted(options.signal);
    const file = await copyFileTo(from, to, options.overwrite ?? false);
    await options.onProgress?.({ phase: "copy", done: 1, total: 1, path: path.basename(from) });
    return {
      ...file,
      filesCopied: 1,
      skippedSymlinks: 0,
      skippedSpecial: 0,
      symlinksCopied: 0,
      deleted: 0,
    };
  }
  throw new CompareError("That path is not a file or folder.", 400);
}

export async function copyFileTo(
  fromInput: string,
  toInput: string,
  overwrite: boolean,
): Promise<{ to: string; overwritten: boolean }> {
  const from = resolveCopyInput(fromInput);
  const to = resolveCopyInput(toInput);
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

export async function copyTree(
  from: string,
  to: string,
  overwriteOrOptions: boolean | CopyOptions = false,
): Promise<CopyResult> {
  return writeTree(resolveCopyInput(from), resolveCopyInput(to), normalizeOptions(overwriteOrOptions));
}

async function writeTree(from: string, to: string, options: CopyOptions): Promise<CopyResult> {
  assertSafeCopy(from, to);
  await ensureDestinationDirectory(to);
  await options.onProgress?.({ phase: "plan", done: 0, total: 0, path: path.basename(from) });
  const plan = await buildTreePlan(from, to, options);
  const overwritten = plan.files.some((item) => item.exists) || plan.links.some((item) => item.exists);
  if (overwritten && !options.overwrite) {
    throw new CompareError("The destination already contains files from this folder.", 409);
  }
  const copyTotal = plan.files.length + plan.links.length;
  let done = 0;
  for (const directory of plan.directories) {
    throwIfAborted(options.signal);
    await mkdir(directory, { recursive: true });
  }
  for (const item of plan.files) {
    throwIfAborted(options.signal);
    await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: item.relativePath });
    await mkdir(path.dirname(item.to), { recursive: true });
    if (item.exists) {
      const existing = await lstat(item.to);
      if (existing.isSymbolicLink()) await unlink(item.to);
    }
    await copyFile(item.from, item.to);
    done += 1;
    await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: item.relativePath });
  }
  for (const link of plan.links) {
    throwIfAborted(options.signal);
    await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: link.relativePath });
    await mkdir(path.dirname(link.to), { recursive: true });
    if (link.exists) {
      const existing = await lstat(link.to);
      if (existing.isSymbolicLink() || existing.isFile()) await unlink(link.to);
      else throw new CompareError(`A folder is in the way of ${link.to}.`, 400);
    }
    await symlink(link.target, link.to);
    done += 1;
    await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: link.relativePath });
  }
  let deleted = 0;
  if (options.mirror) {
    const deleteTotal = plan.deletions.length;
    for (const [index, item] of plan.deletions.entries()) {
      throwIfAborted(options.signal);
      await options.onProgress?.({ phase: "delete", done: index, total: deleteTotal, path: item.relativePath });
      await removePlanned(to, item);
      deleted += 1;
      await options.onProgress?.({ phase: "delete", done: index + 1, total: deleteTotal, path: item.relativePath });
    }
  }
  return {
    to,
    overwritten,
    filesCopied: plan.files.length,
    skippedSymlinks: plan.skippedLinks.length,
    skippedSpecial: plan.skippedSpecial,
    symlinksCopied: plan.links.length,
    deleted,
  };
}

type TreePlan = {
  files: PlannedFile[];
  links: PlannedLink[];
  skippedLinks: SkippedLink[];
  skippedSpecial: number;
  directories: string[];
  sourcePaths: Set<string>;
  deletions: PlannedDelete[];
};

async function buildTreePlan(from: string, to: string, options: CopyOptions): Promise<TreePlan> {
  const plan: TreePlan = {
    files: [],
    links: [],
    skippedLinks: [],
    skippedSpecial: 0,
    directories: [to],
    sourcePaths: new Set([""]),
    deletions: [],
  };
  const sourceRoot = path.resolve(options.sourceRoot ?? from);
  const destRoot = path.resolve(options.destRoot ?? to);
  await walkSource(from, to, "", plan, options, sourceRoot, destRoot);
  if (options.mirror) await collectDeletions(to, "", plan);
  plan.deletions.sort((left, right) => right.relativePath.length - left.relativePath.length);
  return plan;
}

async function walkSource(
  fromDir: string,
  toDir: string,
  relativeDir: string,
  plan: TreePlan,
  options: CopyOptions,
  sourceRoot: string,
  destRoot: string,
): Promise<void> {
  const dirents = await readdir(fromDir, { withFileTypes: true });
  for (const dirent of dirents) {
    const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
    const source = path.join(fromDir, dirent.name);
    const destination = path.join(toDir, dirent.name);
    if (dirent.isSymbolicLink()) {
      plan.sourcePaths.add(relativePath);
      if (!options.copySymlinks) {
        plan.skippedLinks.push({ path: relativePath, reason: "symlink copying is off" });
        continue;
      }
      const decision = await classifyLink(source, destination, sourceRoot, destRoot);
      if (decision.action === "skip") {
        plan.skippedLinks.push({ path: relativePath, reason: decision.reason });
        continue;
      }
      plan.links.push({
        to: destination,
        relativePath,
        target: decision.target,
        exists: await pathExists(destination),
      });
      continue;
    }
    if (dirent.isDirectory()) {
      plan.sourcePaths.add(relativePath);
      plan.directories.push(destination);
      await walkSource(source, destination, relativePath, plan, options, sourceRoot, destRoot);
      continue;
    }
    if (!dirent.isFile()) {
      plan.skippedSpecial += 1;
      continue;
    }
    plan.sourcePaths.add(relativePath);
    const existing = await destinationKind(destination);
    if (existing === "directory") {
      throw new CompareError(`A folder is in the way of ${destination}.`, 400);
    }
    plan.files.push({
      from: source,
      to: destination,
      relativePath,
      exists: existing !== "missing",
    });
  }
}

async function classifyLink(
  sourceLink: string,
  destinationLink: string,
  sourceRoot: string,
  destRoot: string,
): Promise<{ action: "copy"; target: string } | { action: "skip"; reason: string }> {
  let target = "";
  try {
    target = await readlink(sourceLink);
  } catch {
    return { action: "skip", reason: "could not read the link" };
  }
  const sourceResolved = path.resolve(path.dirname(sourceLink), target);
  if (!isContained(sourceRoot, sourceResolved)) {
    return { action: "skip", reason: "target leaves the compare root" };
  }
  try {
    await lstat(sourceResolved);
  } catch {
    return { action: "skip", reason: "target is missing" };
  }
  const destResolved = path.resolve(path.dirname(destinationLink), target);
  if (!isContained(destRoot, destResolved)) {
    return { action: "skip", reason: "recreated link would leave the destination compare root" };
  }
  return { action: "copy", target };
}

async function collectDeletions(destDir: string, relativeDir: string, plan: TreePlan): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(destDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const dirent of dirents) {
    const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
    const absolute = path.join(destDir, dirent.name);
    if (dirent.isSymbolicLink()) {
      if (!plan.sourcePaths.has(relativePath)) {
        plan.deletions.push({ absolute, relativePath, kind: "symlink" });
      }
      continue;
    }
    if (dirent.isDirectory()) {
      await collectDeletions(absolute, relativePath, plan);
      if (!plan.sourcePaths.has(relativePath)) {
        plan.deletions.push({ absolute, relativePath, kind: "directory" });
      }
      continue;
    }
    if (!plan.sourcePaths.has(relativePath)) {
      plan.deletions.push({ absolute, relativePath, kind: "file" });
    }
  }
}

async function removePlanned(destinationRoot: string, item: PlannedDelete): Promise<void> {
  if (!isContained(destinationRoot, item.absolute)) {
    throw new CompareError("Refusing to delete a path outside the destination folder.", 400);
  }
  let info;
  try {
    info = await lstat(item.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink()) {
    await unlink(item.absolute);
    return;
  }
  if (info.isDirectory()) {
    await rmdir(item.absolute);
    return;
  }
  await unlink(item.absolute);
}

function summarize(plan: TreePlan): CopyPlanSummary {
  return {
    filesToCopy: plan.files.length,
    filesToOverwrite: plan.files.filter((item) => item.exists).length + plan.links.filter((item) => item.exists).length,
    symlinksToCopy: plan.links.length,
    skippedSymlinks: plan.skippedLinks,
    skippedSpecial: plan.skippedSpecial,
    deletions: plan.deletions.map((item) => ({ relativePath: item.relativePath, kind: item.kind })),
  };
}

async function ensureDestinationDirectory(to: string): Promise<void> {
  try {
    const destinationStat = await lstat(to);
    if (destinationStat.isSymbolicLink()) throw new CompareError("Refusing to copy onto a symlink.", 400);
    if (!destinationStat.isDirectory()) throw new CompareError("The destination is a file, not a folder.", 400);
  } catch (error) {
    if (error instanceof CompareError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new CompareError(error instanceof Error ? error.message : "Could not inspect the destination.", 400);
    }
  }
}

async function pathExists(target: string): Promise<boolean> {
  return (await destinationKind(target)) !== "missing";
}

async function destinationKind(target: string): Promise<"file" | "directory" | "symlink" | "other" | "missing"> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) return "symlink";
    if (info.isDirectory()) return "directory";
    if (info.isFile()) return "file";
    return "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
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

function resolveCopyInput(input: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new CompareError("Choose a source file and a destination.");
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

function normalizeOptions(overwriteOrOptions: boolean | CopyOptions): CopyOptions {
  if (typeof overwriteOrOptions === "boolean") return { overwrite: overwriteOrOptions };
  return { overwrite: false, ...overwriteOrOptions };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompareError("Copy cancelled.", 499);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isFilesystemRoot(target: string): boolean {
  return path.resolve(target) === path.parse(target).root;
}
