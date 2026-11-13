import { randomBytes } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readlink, rename, rmdir, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CompareError } from "./errors";
import { isFilesystemRoot, isStrictlyInside, isWindowsAbsolute, normalizeUserPath } from "./paths";

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

export type CopyCancelReport = {
  /** Paths this copy created, then removed. */
  removed: string[];
  /** Paths this copy overwrote or removed, then put back. */
  restored: string[];
  /** Paths that could not be undone. They are a partial copy. */
  partial: string[];
};

export class CopyCancelledError extends CompareError {
  readonly report: CopyCancelReport;

  constructor(report: CopyCancelReport) {
    super(formatCopyCancelled(report), 499);
    this.name = "CopyCancelledError";
    this.report = report;
  }
}

export function formatCopyCancelled(report: CopyCancelReport): string {
  const removed = report.removed.filter(Boolean);
  const restored = report.restored.filter(Boolean);
  const partial = report.partial.filter(Boolean);
  if (partial.length > 0) {
    const shown = partial.slice(0, 8).join(", ");
    const extra = partial.length > 8 ? ` and ${partial.length - 8} more` : "";
    return `Partial copy: cancelled, but these paths could not be rolled back: ${shown}${extra}. Other paths written by this copy were removed or restored. Pre-existing files this copy did not write were left in place.`;
  }
  if (removed.length === 0 && restored.length === 0) {
    return "Copy cancelled. Nothing from this copy was left on the destination.";
  }
  const parts = ["Copy cancelled."];
  if (removed.length > 0) {
    parts.push(`Removed ${removed.length} path${removed.length === 1 ? "" : "s"} this copy had created.`);
  }
  if (restored.length > 0) {
    parts.push(`Restored ${restored.length} path${restored.length === 1 ? "" : "s"} this copy had overwritten or removed.`);
  }
  parts.push("Pre-existing files this copy did not write were left in place.");
  return parts.join(" ");
}

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
    const journal = new CopyJournal();
    try {
      await options.onProgress?.({ phase: "copy", done: 0, total: 1, path: path.basename(from) });
      throwIfAborted(options.signal);
      const overwritten = await writeRegularFile(from, to, options.overwrite ?? false, journal, path.basename(from));
      await options.onProgress?.({ phase: "copy", done: 1, total: 1, path: path.basename(from) });
      throwIfAborted(options.signal);
      await journal.commit();
      return {
        to,
        overwritten,
        filesCopied: 1,
        skippedSymlinks: 0,
        skippedSpecial: 0,
        symlinksCopied: 0,
        deleted: 0,
      };
    } catch (error) {
      throw await finishCopyError(error, options.signal, journal);
    }
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
  const overwritten = await writeRegularFile(from, to, overwrite);
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
  const journal = new CopyJournal();
  try {
    await ensureDestinationDirectory(to);
    await options.onProgress?.({ phase: "plan", done: 0, total: 0, path: path.basename(from) });
    throwIfAborted(options.signal);
    const plan = await buildTreePlan(from, to, options);
    throwIfAborted(options.signal);
    const overwritten = plan.files.some((item) => item.exists) || plan.links.some((item) => item.exists);
    if (overwritten && !options.overwrite) {
      throw new CompareError("The destination already contains files from this folder.", 409);
    }
    const copyTotal = plan.files.length + plan.links.length;
    let done = 0;
    for (const directory of plan.directories) {
      throwIfAborted(options.signal);
      await createDirectory(directory, to, journal);
    }
    for (const item of plan.files) {
      throwIfAborted(options.signal);
      await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: item.relativePath });
      throwIfAborted(options.signal);
      await writeRegularFile(item.from, item.to, true, journal, item.relativePath);
      done += 1;
      await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: item.relativePath });
      throwIfAborted(options.signal);
    }
    for (const link of plan.links) {
      throwIfAborted(options.signal);
      await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: link.relativePath });
      throwIfAborted(options.signal);
      await writeLink(link, journal);
      done += 1;
      await options.onProgress?.({ phase: "copy", done, total: copyTotal, path: link.relativePath });
      throwIfAborted(options.signal);
    }
    let deleted = 0;
    if (options.mirror) {
      const deleteTotal = plan.deletions.length;
      for (const [index, item] of plan.deletions.entries()) {
        throwIfAborted(options.signal);
        await options.onProgress?.({ phase: "delete", done: index, total: deleteTotal, path: item.relativePath });
        throwIfAborted(options.signal);
        await removePlanned(to, item, journal);
        deleted += 1;
        await options.onProgress?.({ phase: "delete", done: index + 1, total: deleteTotal, path: item.relativePath });
        throwIfAborted(options.signal);
      }
    }
    await journal.commit();
    return {
      to,
      overwritten,
      filesCopied: plan.files.length,
      skippedSymlinks: plan.skippedLinks.length,
      skippedSpecial: plan.skippedSpecial,
      symlinksCopied: plan.links.length,
      deleted,
    };
  } catch (error) {
    throw await finishCopyError(error, options.signal, journal);
  }
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
  const sourceRoot = normalizeUserPath(options.sourceRoot ?? from);
  const destRoot = normalizeUserPath(options.destRoot ?? to);
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
    throwIfAborted(options.signal);
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
  const sourceResolved = resolveAgainst(sourceLink, target);
  if (!isContained(sourceRoot, sourceResolved)) {
    return { action: "skip", reason: "target leaves the compare root" };
  }
  try {
    await lstat(sourceResolved);
  } catch {
    return { action: "skip", reason: "target is missing" };
  }
  const destResolved = resolveAgainst(destinationLink, target);
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

async function removePlanned(destinationRoot: string, item: PlannedDelete, journal: CopyJournal): Promise<void> {
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
    const target = await readlink(item.absolute);
    await unlink(item.absolute);
    journal.add({ op: "restore-link", path: item.absolute, target, relativePath: item.relativePath });
    return;
  }
  if (info.isDirectory()) {
    await rmdir(item.absolute);
    journal.add({ op: "removed-dir", path: item.absolute, relativePath: item.relativePath });
    return;
  }
  const backup = await stageAside(item.absolute);
  journal.add({ op: "staged", path: item.absolute, backup, relativePath: item.relativePath });
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
  const root = normalizeUserPath(rootInput);
  const api = isWindowsAbsolute(root) ? path.win32 : path;
  const target = api.resolve(root, ...parts);
  const relative = api.relative(root, target);
  if (relative === "" || relative.startsWith("..") || api.isAbsolute(relative)) {
    throw new CompareError("That path leaves the folder you are comparing.");
  }
  return target;
}

export function assertSafeCopy(fromInput: string, toInput: string): void {
  const source = normalizeUserPath(fromInput);
  const destination = normalizeUserPath(toInput);
  if (isFilesystemRoot(source)) throw new CompareError("Refusing to copy a drive root.");
  if (isFilesystemRoot(destination)) throw new CompareError("Refusing to copy onto a drive root.");
  if (source === destination) throw new CompareError("Source and destination are the same path.");
  if (isStrictlyInside(source, destination) || isStrictlyInside(destination, source)) {
    throw new CompareError("Refusing to copy a folder into itself.");
  }
}

function resolveCopyInput(input: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new CompareError("Choose a source file and a destination.");
  }
  return normalizeUserPath(input);
}

async function writeRegularFile(
  from: string,
  to: string,
  overwrite: boolean,
  journal?: CopyJournal,
  relativePath?: string,
): Promise<boolean> {
  const source = await lstat(from);
  if (source.isSymbolicLink() || !source.isFile()) {
    throw new CompareError("Only regular files can be copied.", 400);
  }
  const kind = await destinationKind(to);
  if (kind === "directory") throw new CompareError("The destination is a directory.", 400);
  if (kind !== "missing" && !overwrite) throw new CompareError("The destination already exists.", 409);
  const label = relativePath && relativePath.length > 0 ? relativePath : path.basename(to);
  await ensureParentDirectories(to, journal);
  if (kind === "symlink") {
    const target = await readlink(to);
    journal?.add({ op: "restore-link", path: to, target, relativePath: label });
    await unlink(to);
  } else if (kind === "file" && journal) {
    const backup = tempBackupPath();
    await copyFile(to, backup);
    journal.add({ op: "backup-file", path: to, backup, relativePath: label });
  } else if (kind === "other" && journal) {
    journal.add({ op: "unrestorable", path: to, relativePath: label });
  } else if (kind === "missing" && journal) {
    journal.add({ op: "created-file", path: to, relativePath: label });
  }
  await copyFile(from, to);
  return kind !== "missing";
}

async function writeLink(link: PlannedLink, journal: CopyJournal): Promise<void> {
  await ensureParentDirectories(link.to, journal);
  if (link.exists) {
    const existing = await lstat(link.to);
    if (existing.isSymbolicLink()) {
      const previous = await readlink(link.to);
      journal.add({ op: "restore-link", path: link.to, target: previous, relativePath: link.relativePath });
      await unlink(link.to);
    } else if (existing.isFile()) {
      const backup = tempBackupPath();
      await copyFile(link.to, backup);
      journal.add({ op: "backup-file", path: link.to, backup, relativePath: link.relativePath });
      await unlink(link.to);
    } else {
      throw new CompareError(`A folder is in the way of ${link.to}.`, 400);
    }
  } else {
    journal.add({ op: "created-link", path: link.to, relativePath: link.relativePath });
  }
  await symlink(link.target, link.to);
}

async function createDirectory(directory: string, destinationRoot: string, journal: CopyJournal): Promise<void> {
  const existed = await destinationKind(directory);
  if (existed === "symlink") throw new CompareError("Refusing to copy onto a symlink.", 400);
  if (existed !== "missing" && existed !== "directory") {
    throw new CompareError("The destination is a file, not a folder.", 400);
  }
  if (existed === "directory") return;
  await ensureParentDirectories(directory, journal);
  await mkdir(directory);
  const relativePath = directory === destinationRoot ? path.basename(directory) : relativeToRoot(destinationRoot, directory);
  journal.add({ op: "created-dir", path: directory, relativePath });
}

function normalizeOptions(overwriteOrOptions: boolean | CopyOptions): CopyOptions {
  if (typeof overwriteOrOptions === "boolean") return { overwrite: overwriteOrOptions };
  return { overwrite: false, ...overwriteOrOptions };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompareError("Copy cancelled.", 499);
}

function isContained(root: string, target: string): boolean {
  const api = isWindowsAbsolute(root) ? path.win32 : path;
  const relative = api.relative(api.resolve(root), api.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !api.isAbsolute(relative));
}

function resolveAgainst(linkPath: string, target: string): string {
  const api = isWindowsAbsolute(linkPath) ? path.win32 : path;
  return api.resolve(api.dirname(linkPath), target);
}

function relativeToRoot(root: string, target: string): string {
  const api = isWindowsAbsolute(root) ? path.win32 : path;
  const relative = api.relative(root, target);
  if (!relative || relative.startsWith("..") || api.isAbsolute(relative)) return api.basename(target);
  return relative.split(api.sep).join("/");
}

async function ensureParentDirectories(target: string, journal?: CopyJournal): Promise<void> {
  const parent = path.dirname(target);
  if (parent === target) return;
  const kind = await destinationKind(parent);
  if (kind === "directory") return;
  if (kind !== "missing") throw new CompareError("The destination is not a folder.", 400);
  await ensureParentDirectories(parent, journal);
  await mkdir(parent);
  journal?.add({ op: "created-dir", path: parent, relativePath: path.basename(parent) });
}

function tempBackupPath(): string {
  return path.join(os.tmpdir(), `folderdiff-rollback-${randomBytes(8).toString("hex")}`);
}

async function stageAside(target: string): Promise<string> {
  const backup = tempBackupPath();
  try {
    await rename(target, backup);
    return backup;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  await copyFile(target, backup);
  await unlink(target);
  return backup;
}

async function finishCopyError(error: unknown, signal: AbortSignal | undefined, journal: CopyJournal): Promise<unknown> {
  const cancelled = Boolean(signal?.aborted) || (error instanceof CompareError && error.status === 499);
  const report = await journal.rollback();
  if (cancelled) return new CopyCancelledError(report);
  if (report.partial.length > 0 && error instanceof Error) {
    error.message = `${error.message} Partial copy left behind: ${report.partial.join(", ")}.`;
  }
  return error;
}

type JournalEntry =
  | { op: "created-dir"; path: string; relativePath: string }
  | { op: "created-file"; path: string; relativePath: string }
  | { op: "created-link"; path: string; relativePath: string }
  | { op: "backup-file"; path: string; backup: string; relativePath: string }
  | { op: "restore-link"; path: string; target: string; relativePath: string }
  | { op: "staged"; path: string; backup: string; relativePath: string }
  | { op: "removed-dir"; path: string; relativePath: string }
  | { op: "unrestorable"; path: string; relativePath: string };

class CopyJournal {
  private entries: JournalEntry[] = [];

  add(entry: JournalEntry): void {
    this.entries.push(entry);
  }

  async commit(): Promise<void> {
    for (const entry of this.entries) {
      if ((entry.op === "backup-file" || entry.op === "staged") && entry.backup) {
        await unlink(entry.backup).catch(() => undefined);
      }
    }
    this.entries = [];
  }

  async rollback(): Promise<CopyCancelReport> {
    const removed: string[] = [];
    const restored: string[] = [];
    const partial: string[] = [];
    for (const entry of [...this.entries].reverse()) {
      try {
        await undoJournalEntry(entry);
        if (entry.op === "created-dir" || entry.op === "created-file" || entry.op === "created-link") {
          removed.push(entry.relativePath);
        } else if (entry.op !== "unrestorable") {
          restored.push(entry.relativePath);
        }
      } catch {
        partial.push(entry.relativePath);
      }
    }
    this.entries = [];
    return { removed, restored, partial };
  }
}

async function undoJournalEntry(entry: JournalEntry): Promise<void> {
  if (entry.op === "unrestorable") throw new Error("unsafe");
  if (entry.op === "created-file" || entry.op === "created-link") {
    await unlinkIfExists(entry.path);
    return;
  }
  if (entry.op === "created-dir") {
    try {
      await rmdir(entry.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    return;
  }
  if (entry.op === "removed-dir") {
    await mkdir(entry.path);
    return;
  }
  if (entry.op === "restore-link") {
    await unlinkIfExists(entry.path);
    await symlink(entry.target, entry.path);
    return;
  }
  if (entry.op === "backup-file") {
    await restoreBackupFile(entry.backup, entry.path);
    return;
  }
  await restoreStaged(entry.backup, entry.path);
}

async function restoreBackupFile(backup: string, target: string): Promise<void> {
  const holding = `${target}.folderdiff-restore-${randomBytes(4).toString("hex")}`;
  await copyFile(backup, holding);
  await unlinkIfExists(target);
  try {
    await rename(holding, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(holding, target);
    await unlink(holding);
  }
  await unlink(backup).catch(() => undefined);
}

async function restoreStaged(backup: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const info = await lstat(backup);
  if (info.isSymbolicLink()) {
    const linkTarget = await readlink(backup);
    await unlinkIfExists(target);
    await symlink(linkTarget, target);
    await unlink(backup);
    return;
  }
  if ((await destinationKind(target)) !== "missing") throw new Error("path occupied");
  try {
    await rename(backup, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(backup, target);
    await unlink(backup);
  }
}

async function unlinkIfExists(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
