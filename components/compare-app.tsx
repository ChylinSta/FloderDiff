"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FixturePaths } from "@/lib/compare/fixtures";
import type { CompareEntry, CompareProgress, FileDiffResult, FolderCompareResult } from "@/lib/compare/types";

import { BrowseDialog } from "./browse-dialog";
import { defaultExpanded, type StatusFilter } from "./compare-view";
import { FileDiffView } from "./file-diff-view";
import { FolderTree } from "./folder-tree";

type Mode = "folders" | "files";

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "changes", label: "Changes" },
  { id: "all", label: "All" },
  { id: "different", label: "Different" },
  { id: "left-only", label: "Left only" },
  { id: "right-only", label: "Right only" },
  { id: "same", label: "Same" },
];

export function CompareApp() {
  const [mode, setMode] = useState<Mode>("folders");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [patternsText, setPatternsText] = useState("node_modules, .git, .DS_Store");
  const [nameQuery, setNameQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("changes");
  const [folder, setFolder] = useState<FolderCompareResult | null>(null);
  const [diff, setDiff] = useState<FileDiffResult | null>(null);
  const [diffSource, setDiffSource] = useState<"file" | "entry" | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"tree" | "diff">("tree");
  const [fixtures, setFixtures] = useState<FixturePaths | null>(null);
  const [progress, setProgress] = useState<CompareProgress | null>(null);
  const [copyProgress, setCopyProgress] = useState<CopyProgress | null>(null);
  const [mirrorCopy, setMirrorCopy] = useState(false);
  const [copyLinks, setCopyLinks] = useState(false);
  const [copyPreview, setCopyPreview] = useState<CopyPlan | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [pendingCopy, setPendingCopy] = useState<PendingCopy | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fixtures", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as FixturePaths & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not read sample paths.");
        return body;
      })
      .then((paths) => {
        if (!cancelled) setFixtures(paths);
      })
      .catch(() => {
        if (!cancelled) setFixtures(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setRecent(readRecent()), 0);
    return () => window.clearTimeout(id);
  }, []);

  const selected = folder?.entries.find((entry) => entry.relativePath === selectedPath) ?? null;

  async function runCompare(overrides?: { mode?: Mode; left?: string; right?: string; keepSelection?: boolean; keepCopyStatus?: boolean }): Promise<boolean> {
    const nextMode = overrides?.mode ?? mode;
    const nextLeft = (overrides?.left ?? left).trim();
    const nextRight = (overrides?.right ?? right).trim();
    if (!nextLeft || !nextRight) {
      setError("Enter both paths, or open a sample.");
      return false;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    if (!overrides?.keepCopyStatus) setCopyProgress(null);
    setProgress(null);
    setError(null);
    setNotice(null);
    setManualCopy(null);
    const previousSelection = overrides?.keepSelection ? selectedPath : null;
    try {
      if (nextMode === "folders") {
        const patterns = patternsText
          .split(",")
          .map((pattern) => pattern.trim())
          .filter(Boolean);
        setProgress({ phase: "walk", done: 0, total: 0 });
        const result = await streamCompare(
          { left: nextLeft, right: nextRight, patterns },
          { signal: controller.signal, onProgress: setProgress },
        );
        if (controller.signal.aborted) return false;
        setRecent(rememberPaths([result.leftRoot, result.rightRoot]));
        setFolder(result);
        setExpanded(defaultExpanded(result.entries));
        setMobilePane("tree");
        const stillThere = previousSelection
          ? result.entries.find((entry) => entry.relativePath === previousSelection)
          : undefined;
        if (stillThere && canDiff(stillThere)) {
          setSelectedPath(stillThere.relativePath);
          setDiffSource("entry");
          setDiff(await postJson<FileDiffResult>("/api/diff", {
            left: stillThere.leftPath,
            right: stillThere.rightPath,
          }));
        } else {
          setSelectedPath(stillThere?.relativePath ?? null);
          setDiff(null);
          setDiffSource(null);
        }
      } else {
        const result = await postJson<FileDiffResult>("/api/diff", { left: nextLeft, right: nextRight }, controller.signal);
        if (controller.signal.aborted) return false;
        setRecent(rememberPaths([nextLeft, nextRight]));
        setDiff(result);
        setDiffSource("file");
        setFolder(null);
        setSelectedPath(null);
        setMobilePane("diff");
      }
            return true;
    } catch (caught) {
      if (isAbort(caught) || controller.signal.aborted) {
        setNotice("Compare cancelled.");
      } else {
        setError(caught instanceof Error ? caught.message : "Compare failed.");
      }
      if (abortRef.current === controller) setProgress(null);
      return false;
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }

  function cancelCompare() {
    abortRef.current?.abort();
  }

  function requestFileCopy(direction: "left-to-right" | "right-to-left") {
    if (mode === "files") {
      const from = direction === "left-to-right" ? left.trim() : right.trim();
      const to = direction === "left-to-right" ? right.trim() : left.trim();
      if (!from || !to) return;
      setPendingCopy({
        from,
        to,
        overwrite: true,
        kind: "file",
        title: "Overwrite this file?",
        label: `Replace ${to} with the other file? This overwrites that path.`,
      });
      return;
    }
    if (!selected || !folder || (selected.type !== "file" && selected.type !== "directory")) return;
    const from = direction === "left-to-right" ? selected.leftPath : selected.rightPath;
    const toRoot = direction === "left-to-right" ? folder.rightRoot : folder.leftRoot;
    const sourceRoot = direction === "left-to-right" ? folder.leftRoot : folder.rightRoot;
    const destinationExists = direction === "left-to-right" ? Boolean(selected.right) : Boolean(selected.left);
    if (!from) return;
    const side = direction === "left-to-right" ? "right" : "left";
    const folderCopy = selected.type === "directory";
    setMirrorCopy(false);
    setCopyLinks(false);
    setCopyPreview(null);
    setPendingCopy({
      from,
      toRoot,
      sourceRoot,
      destRoot: toRoot,
      relativePath: selected.relativePath,
      overwrite: destinationExists,
      kind: folderCopy ? "directory" : "file",
      title: folderCopy ? "Copy this folder?" : destinationExists ? "Overwrite this file?" : "Copy this file?",
      label: folderCopy
        ? `Copy the folder ${selected.relativePath} to the ${side}? The source folder is not deleted.`
        : destinationExists
          ? `Replace ${selected.relativePath} on the ${side}? This overwrites that file. The source is not deleted.`
          : `Copy ${selected.relativePath} to the ${side}? A new file will be created there.`,
    });
  }

  useEffect(() => {
    if (!pendingCopy || pendingCopy.kind !== "directory") return;
    const request = pendingCopy;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void postJson<CopyPlan>("/api/copy/preview", {
        from: request.from,
        toRoot: request.toRoot,
        relativePath: request.relativePath,
        overwrite: request.overwrite || mirrorCopy,
        mirror: mirrorCopy,
        copySymlinks: copyLinks,
        sourceRoot: request.sourceRoot,
        destRoot: request.destRoot,
      })
        .then((plan) => {
          if (!cancelled) setCopyPreview(plan);
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not preview that copy.");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pendingCopy, mirrorCopy, copyLinks]);

  async function confirmCopy() {
    if (!pendingCopy) return;
    const request = pendingCopy;
    const mirror = request.kind === "directory" && mirrorCopy;
    const recreateLinks = request.kind === "directory" && copyLinks;
    setPendingCopy(null);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setProgress(null);
    setCopyProgress({ phase: "copy", done: 0, total: 0, path: request.relativePath });
    try {
      const result = await streamCopy(
        {
          from: request.from,
          to: request.to,
          toRoot: request.toRoot,
          relativePath: request.relativePath,
          overwrite: request.overwrite || mirror,
          mirror,
          copySymlinks: recreateLinks,
          sourceRoot: request.sourceRoot,
          destRoot: request.destRoot,
        },
        { signal: controller.signal, onProgress: setCopyProgress },
      );
      if (controller.signal.aborted) return;
      const copied = result.filesCopied ?? 0;
      const removed = result.deleted ?? 0;
      setCopyProgress({
        phase: "copy",
        done: copied,
        total: Math.max(copied, 1),
        path: removed > 0 ? `removed ${removed} destination-only` : request.relativePath,
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const refreshed = await runCompare({ keepSelection: true, keepCopyStatus: true });
      if (refreshed) setNotice(describeCopy(result));
    } catch (caught) {
      if (isAbort(caught) || controller.signal.aborted) {
        setCopyProgress(null);
        await runCompare({ keepSelection: true, keepCopyStatus: true });
        setNotice("Copy cancelled. Files already copied stay on the destination.");
        return;
      }
      setCopyProgress(null);
      setLoading(false);
      setError(caught instanceof Error ? caught.message : "Could not copy that path.");
    }
  }

  async function selectEntry(entry: CompareEntry) {
    setSelectedPath(entry.relativePath);
    setNotice(null);
    setMobilePane("diff");
    if (!canDiff(entry)) {
      setDiff(null);
      setDiffSource(null);
      return;
    }
    setLoading(true);
    setError(null);
    setDiff(null);
    setDiffSource("entry");
    try {
      setDiff(
        await postJson<FileDiffResult>("/api/diff", {
          left: entry.leftPath,
          right: entry.rightPath,
        }),
      );
    } catch (caught) {
      setDiff(null);
      setDiffSource(null);
      setError(caught instanceof Error ? caught.message : "Could not diff that file.");
    } finally {
      setLoading(false);
    }
  }

  async function copyPath(target: string) {
    try {
      await navigator.clipboard.writeText(target);
      setManualCopy(null);
      setNotice("Copied the path.");
    } catch {
      setManualCopy(target);
      setNotice("Clipboard is unavailable in this browser.");
    }
  }

  async function openPath(target: string) {
    setNotice(null);
    try {
      await postJson("/api/open", { path: target });
      setNotice("Asked the system to open that path.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that path.");
    }
  }

  function loadSample(kind: "folders" | "files") {
    if (!fixtures) {
      setError("Sample paths are not available. Paste two paths instead.");
      return;
    }
    if (kind === "folders") {
      setMode("folders");
      setLeft(fixtures.leftDir);
      setRight(fixtures.rightDir);
      void runCompare({ mode: "folders", left: fixtures.leftDir, right: fixtures.rightDir });
      return;
    }
    setMode("files");
    setLeft(fixtures.leftFile);
    setRight(fixtures.rightFile);
    void runCompare({ mode: "files", left: fixtures.leftFile, right: fixtures.rightFile });
  }

  const activeDiff = mode === "files" ? (diffSource === "file" ? diff : null) : diffSource === "entry" ? diff : null;
  const detail = describeSelection(mode, selected, left, right, activeDiff);
  const fileCopy = copyAffordances(mode, selected, activeDiff, left, right);
  const showTree = mode === "folders" && folder;
  const hasWorkspace = mode === "folders" ? Boolean(folder) || loading : Boolean(activeDiff) || loading;

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative h-8 w-9 shrink-0 text-primary" aria-hidden>
            <span className="absolute top-1 left-0 h-6 w-4 rounded-[4px] border-2 border-current bg-card" />
            <span className="absolute top-1 right-0 h-6 w-4 rounded-[4px] border-2 border-current bg-background" />
          </span>
          <div>
            <h1 className="text-base font-semibold tracking-tight">FolderDiff</h1>
            <p className="text-xs text-muted-foreground">Compare files and folders on this machine.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
            <TabsList>
              <TabsTrigger value="folders">Folders</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void runCompare({ keepSelection: true })}>
            Refresh
          </Button>
          {loading ? (
            <Button type="button" variant="outline" onClick={cancelCompare}>
              Cancel
            </Button>
          ) : null}
        </div>
      </header>

      {copyProgress ? (
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-primary px-4 py-2 text-sm text-primary-foreground" role="status">
          <span>
            {copyProgress.phase === "delete" ? "Removing" : copyProgress.phase === "plan" ? "Planning copy" : "Copying"}
            {copyProgress.total > 0 ? ` ${copyProgress.done} / ${copyProgress.total}` : ""}
          </span>
          {copyProgress.path ? <span className="min-w-0 flex-1 truncate font-mono text-xs opacity-90">{copyProgress.path}</span> : null}
          {loading && !progress ? (
            <Button type="button" size="sm" variant="secondary" onClick={cancelCompare}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
      {progress ? (
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-primary px-4 py-2 text-sm text-primary-foreground" role="status">
          <span>
            {loading
              ? progress.phase === "walk"
                ? "Walking both trees"
                : "Hashing files"
              : progress.phase === "hash"
                ? "Finished hashing"
                : "Finished walking"}
            {progress.phase === "hash" ? ` ${progress.done} / ${progress.total}` : ` · ${progress.done} paths`}
          </span>
          {progress.path ? <span className="min-w-0 flex-1 truncate font-mono text-xs opacity-90">{progress.path}</span> : null}
          {loading ? (
            <Button type="button" size="sm" variant="secondary" onClick={cancelCompare}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      <form
        className="grid gap-3 border-b px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void runCompare();
        }}
      >
        <PathField id="left-path" label="Left" value={left} onChange={setLeft} onBrowse={() => setBrowseOpen(true)} />
        <PathField id="right-path" label="Right" value={right} onChange={setRight} onBrowse={() => setBrowseOpen(true)} />
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" disabled={loading}>
            {loading ? "Reading…" : mode === "folders" ? "Compare folders" : "Compare files"}
          </Button>
          <Button type="button" variant="outline" onClick={() => loadSample("folders")}>
            Sample folders
          </Button>
          <Button type="button" variant="outline" onClick={() => loadSample("files")}>
            Sample files
          </Button>
        </div>
        <label className="block text-xs font-medium text-muted-foreground lg:col-span-2">
          Ignore patterns
          <Input
            value={patternsText}
            onChange={(event) => setPatternsText(event.target.value)}
            className="mt-1 font-mono"
            placeholder="node_modules, .git, *.log"
            aria-describedby="ignore-help"
          />
          <span id="ignore-help" className="mt-1 block font-normal">
            Comma-separated. A plain name ignores that folder anywhere. Clear the field to ignore nothing. `*.log` is not on by default.
          </span>
        </label>
        {mode === "folders" ? (
          <label className="block text-xs font-medium text-muted-foreground">
            Name filter
            <Input
              value={nameQuery}
              onChange={(event) => setNameQuery(event.target.value)}
              className="mt-1"
              placeholder="util.ts"
            />
          </label>
        ) : (
          <p className="self-end text-xs text-muted-foreground">
            Line endings are aligned. A null byte or invalid UTF-8 is reported as binary.
          </p>
        )}
        {recent.length > 0 ? (
          <div className="flex flex-col gap-1 lg:col-span-3">
            <span className="text-xs font-medium text-muted-foreground">Recent paths</span>
            {recent.slice(0, 4).map((path) => (
              <div key={path} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-normal" title={path}>
                  {path}
                </span>
                <Button type="button" size="xs" variant="outline" onClick={() => setLeft(path)}>
                  Left
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={() => setRight(path)}>
                  Right
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </form>

      {error ? (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="border-b px-4 py-2 text-sm text-muted-foreground">
          {notice}
          {manualCopy ? (
            <input
              readOnly
              value={manualCopy}
              aria-label="Path to copy"
              className="mt-1 block w-full bg-transparent font-mono text-xs text-foreground outline-none"
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-1 flex-col lg:min-h-0">
        {!hasWorkspace ? (
          <EmptyState onFolders={() => loadSample("folders")} onFiles={() => loadSample("files")} />
        ) : (
          <>
            {showTree && folder ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
                {FILTERS.map((filter) => (
                  <Button
                    key={filter.id}
                    type="button"
                    size="sm"
                    variant={statusFilter === filter.id ? "default" : "outline"}
                    aria-pressed={statusFilter === filter.id}
                    onClick={() => setStatusFilter(filter.id)}
                  >
                    {filter.label}
                    <span className="text-[10px] opacity-80">{countFor(folder, filter.id)}</span>
                  </Button>
                ))}
                {folder.summary.errors > 0 ? (
                  <span className="px-2 text-xs text-destructive">{folder.summary.errors} unreadable</span>
                ) : null}
                <span className="ml-auto hidden text-xs text-muted-foreground md:inline">
                  Ignoring {folder.patterns.length > 0 ? folder.patterns.join(", ") : "nothing"}
                </span>
              </div>
            ) : null}
            <div
              className={
                showTree
                  ? "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]"
                  : "flex min-h-0 w-full flex-1"
              }
            >
              {showTree && folder ? (
                <div className={mobilePane === "diff" ? "hidden border-r lg:block lg:min-h-0 lg:overflow-auto" : "border-r lg:min-h-0 lg:overflow-auto"}>
                  <FolderTree
                    entries={folder.entries}
                    selected={selectedPath}
                    expanded={expanded}
                    nameQuery={nameQuery}
                    statusFilter={statusFilter}
                    onToggle={(relativePath) => {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(relativePath)) next.delete(relativePath);
                        else next.add(relativePath);
                        return next;
                      });
                    }}
                    onSelect={(entry) => void selectEntry(entry)}
                  />
                </div>
              ) : null}
              <div className={showTree && mobilePane === "tree" ? "hidden min-h-0 w-full lg:flex" : "flex min-h-0 w-full"}>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {showTree ? (
                    <div className="border-b px-3 py-1 lg:hidden">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setMobilePane("tree")}>
                        Back to folders
                      </Button>
                    </div>
                  ) : null}
                  <FileDiffView
                    diff={detail.showDiff ? activeDiff : null}
                    heading={detail.heading}
                    note={detail.note}
                    leftPath={detail.leftPath}
                    rightPath={detail.rightPath}
                    loading={loading}
                    onCopy={(target) => void copyPath(target)}
                    onOpen={(target) => void openPath(target)}
                    fileCopy={
                      fileCopy
                        ? {
                            leftToRight: fileCopy.leftToRight,
                            rightToLeft: fileCopy.rightToLeft,
                            noun: fileCopy.noun,
                            onCopy: requestFileCopy,
                          }
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <footer className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        FolderDiff reads files for the account running this server. It copies, and can remove destination-only files, only after you confirm. It listens on 127.0.0.1.
      </footer>

      <Dialog open={pendingCopy !== null} onOpenChange={(open) => { if (!open) setPendingCopy(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingCopy?.title ?? "Copy?"}</DialogTitle>
            <DialogDescription>{pendingCopy?.label}</DialogDescription>
          </DialogHeader>
          {pendingCopy?.kind === "directory" ? (
            <div className="space-y-3 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={mirrorCopy}
                  onChange={(event) => {
                    setMirrorCopy(event.target.checked);
                    setCopyPreview(null);
                  }}
                />
                <span>Also remove files and folders that exist only on the destination.</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={copyLinks}
                  onChange={(event) => {
                    setCopyLinks(event.target.checked);
                    setCopyPreview(null);
                  }}
                />
                <span>
                  Recreate symlinks whose targets stay inside this compare. Links that point outside, or whose target is missing, are skipped and not followed.
                </span>
              </label>
              {mirrorCopy ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                  <p>
                    {copyPreview
                      ? `This will delete ${copyPreview.deletions.length} item${copyPreview.deletions.length === 1 ? "" : "s"} that exist${copyPreview.deletions.length === 1 ? "s" : ""} only on the destination.`
                      : "Checking what would be deleted…"}
                    {" "}FolderDiff cannot undo that.
                  </p>
                  {copyPreview && copyPreview.deletions.length > 0 ? (
                    <ul className="mt-2 list-disc pl-4 font-mono text-xs">
                      {copyPreview.deletions.slice(0, 6).map((item) => (
                        <li key={item.relativePath}>{item.relativePath}</li>
                      ))}
                    </ul>
                  ) : null}
                  {copyPreview && copyPreview.deletions.length > 6 ? (
                    <p className="mt-1 text-xs">and {copyPreview.deletions.length - 6} more</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">Files that exist only on the destination stay.</p>
              )}
              {copyLinks && copyPreview ? (
                <p className="text-muted-foreground">
                  Will recreate {copyPreview.symlinksToCopy} symlink{copyPreview.symlinksToCopy === 1 ? "" : "s"}. Skipping {copyPreview.skippedSymlinks.length} that leave the compare or are missing.
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingCopy(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void confirmCopy()}>
              {pendingCopy?.overwrite ? "Overwrite" : "Copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BrowseDialog
        open={browseOpen}
        recent={recent}
        onOpenChange={setBrowseOpen}
        onPick={(path, kind, side) => {
          if (side === "left") setLeft(path);
          else setRight(path);
          if (kind === "file" && mode === "folders") setMode("files");
          if (kind === "directory" && mode === "files") setMode("folders");
          setBrowseOpen(false);
        }}
      />
    </div>
  );
}

function PathField({
  id,
  label,
  value,
  onChange,
  onBrowse,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
}) {
  const kind = usePathKind(value);
  return (
    <div className="block text-xs font-medium text-muted-foreground">
      <label htmlFor={id}>{label}</label>
      <span className="mt-1 flex gap-1.5">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono"
          placeholder={label === "Left" ? "/path/to/left" : "/path/to/right"}
          spellCheck={false}
        />
        <Button type="button" variant="outline" onClick={onBrowse}>
          Browse
        </Button>
      </span>
      <span className={`mt-1 block font-normal ${kind === "missing" ? "text-destructive" : ""}`}>
        {kindLabel(kind)}
      </span>
    </div>
  );
}

function usePathKind(value: string): string | null {
  const trimmed = value.trim();
  const [checked, setChecked] = useState<{ path: string; kind: string } | null>(null);
  useEffect(() => {
    if (!trimmed) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/stat?path=${encodeURIComponent(trimmed)}`, { cache: "no-store" })
        .then(async (response) => response.json() as Promise<{ exists?: boolean; kind?: string }>)
        .then((body) => {
          setChecked({ path: trimmed, kind: body.exists ? (body.kind ?? "other") : "missing" });
        })
        .catch(() => setChecked({ path: trimmed, kind: "unknown" }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [trimmed]);
  if (!trimmed) return null;
  if (!checked || checked.path !== trimmed) return "checking";
  return checked.kind;
}

function kindLabel(kind: string | null): string {
  if (kind === "directory") return "Folder";
  if (kind === "file") return "File";
  if (kind === "symlink") return "Symlink";
  if (kind === "missing") return "Path not found";
  if (kind === "other") return "Special file";
  if (kind === "checking") return "Checking this path…";
  if (kind === "unknown") return "Could not check that path.";
  return "Paste a path, or browse.";
}

function copyAffordances(
  mode: Mode,
  selected: CompareEntry | null,
  diff: FileDiffResult | null,
  left: string,
  right: string,
): { leftToRight: boolean; rightToLeft: boolean; noun?: "file" | "folder" } | null {
  if (mode === "files" && diff && !diff.identical && left.trim() && right.trim()) {
    return { leftToRight: true, rightToLeft: true };
  }
  if (mode !== "folders" || !selected || selected.error) return null;
  if (selected.type !== "file" && selected.type !== "directory") return null;
  const noun = selected.type === "directory" ? "folder" : "file";
  if (selected.status === "left-only") return { leftToRight: true, rightToLeft: false, noun };
  if (selected.status === "right-only") return { leftToRight: false, rightToLeft: true, noun };
  if (selected.status === "different") return { leftToRight: true, rightToLeft: true, noun };
  return null;
}

function describeCopy(result: CopyResponse): string {
  const files = result.filesCopied ?? 0;
  const parts = [`Copied ${files} file${files === 1 ? "" : "s"}.`];
  if (result.symlinksCopied) {
    parts.push(`Recreated ${result.symlinksCopied} symlink${result.symlinksCopied === 1 ? "" : "s"}.`);
  }
  if (result.deleted) {
    parts.push(`Removed ${result.deleted} destination-only item${result.deleted === 1 ? "" : "s"}.`);
  }
  if (result.skippedSymlinks) {
    parts.push(`Skipped ${result.skippedSymlinks} symlink${result.skippedSymlinks === 1 ? "" : "s"}.`);
  }
  if (result.skippedSpecial) {
    parts.push(`Skipped ${result.skippedSpecial} special file${result.skippedSpecial === 1 ? "" : "s"}.`);
  }
  return parts.join(" ");
}

function EmptyState({ onFolders, onFiles }: { onFolders: () => void; onFiles: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h2 className="text-lg font-semibold tracking-tight">See what changed between two trees.</h2>
      <p className="text-sm text-muted-foreground">
        Paste two folder paths or two file paths. FolderDiff marks files that are only on the left, only on the right, the same, or different, then opens a side-by-side line diff.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onFolders}>
          Open sample folders
        </Button>
        <Button type="button" variant="outline" onClick={onFiles}>
          Open sample files
        </Button>
      </div>
    </div>
  );
}

function countFor(folder: FolderCompareResult, filter: StatusFilter): number {
  const summary = folder.summary;
  const fileCount =
    summary.same +
    summary.different +
    summary["left-only"] +
    summary["right-only"] +
    summary["type-mismatch"];
  if (filter === "all") return fileCount;
  if (filter === "changes") {
    return summary.different + summary["left-only"] + summary["right-only"] + summary["type-mismatch"];
  }
  if (filter === "different") return summary.different + summary["type-mismatch"];
  return summary[filter];
}

function canDiff(entry: CompareEntry): boolean {
  return (
    entry.type === "file" &&
    Boolean(entry.leftPath) &&
    Boolean(entry.rightPath) &&
    entry.status !== "left-only" &&
    entry.status !== "right-only" &&
    entry.status !== "type-mismatch" &&
    !entry.error
  );
}

function describeSelection(
  mode: Mode,
  selected: CompareEntry | null,
  left: string,
  right: string,
  diff: FileDiffResult | null,
): { heading: string; note?: string; leftPath?: string; rightPath?: string; showDiff: boolean } {
  if (mode === "files") {
    const hasDiff = Boolean(diff);
    return {
      heading: diff?.kind === "binary" ? "Binary compare" : "Text diff",
      note: hasDiff ? undefined : "Compare the two files to see inserts, deletes, and changes.",
      leftPath: left.trim() || undefined,
      rightPath: right.trim() || undefined,
      showDiff: hasDiff,
    };
  }
  if (!selected) {
    return {
      heading: "File diff",
      note: "Select a file to see its line diff. Identical files stay quiet. Binary files are marked and not line-diffed.",
      showDiff: false,
    };
  }
  if (selected.type === "directory") {
    return {
      heading: selected.relativePath,
      note: `${selected.name} is a folder (${selected.status.replace("-", " ")}). Open a file inside it for a line diff.`,
      leftPath: selected.leftPath,
      rightPath: selected.rightPath,
      showDiff: false,
    };
  }
  if (selected.type === "symlink") {
    return {
      heading: selected.relativePath,
      note: `Symlink, not followed. Left target: ${selected.leftTarget ?? "—"}. Right target: ${selected.rightTarget ?? "—"}.`,
      leftPath: selected.leftPath,
      rightPath: selected.rightPath,
      showDiff: false,
    };
  }
  if (selected.status === "left-only") {
    return {
      heading: selected.relativePath,
      note: "This file is only on the left. There is no right-hand version to diff.",
      leftPath: selected.leftPath,
      showDiff: false,
    };
  }
  if (selected.status === "right-only") {
    return {
      heading: selected.relativePath,
      note: "This file is only on the right. There is no left-hand version to diff.",
      rightPath: selected.rightPath,
      showDiff: false,
    };
  }
  if (selected.status === "type-mismatch") {
    return {
      heading: selected.relativePath,
      note: "One side is a file and the other is a directory, so there is no line diff.",
      leftPath: selected.leftPath,
      rightPath: selected.rightPath,
      showDiff: false,
    };
  }
  if (selected.error) {
    return {
      heading: selected.relativePath,
      note: selected.error,
      leftPath: selected.leftPath,
      rightPath: selected.rightPath,
      showDiff: false,
    };
  }
  return {
    heading: selected.relativePath,
    leftPath: selected.leftPath,
    rightPath: selected.rightPath,
    showDiff: true,
  };
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

type CompareStreamEvent =
  | (CompareProgress & { type: "progress" })
  | { type: "result"; result: FolderCompareResult }
  | { type: "error"; error: string };

async function streamCompare(
  body: { left: string; right: string; patterns: string[] },
  options: { signal: AbortSignal; onProgress: (progress: CompareProgress) => void },
): Promise<FolderCompareResult> {
  const response = await fetch("/api/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: FolderCompareResult | null = null;
  let latest: CompareProgress | null = null;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as CompareStreamEvent;
      if (event.type === "progress") latest = event;
      else if (event.type === "error") throw new Error(event.error);
      else result = event.result;
    }
    if (latest) {
      options.onProgress(latest);
      latest = null;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }
  }
  if (!result) throw new Error("The compare ended before a result was ready.");
  return result;
}

async function streamCopy(
  body: Record<string, unknown>,
  options: { signal: AbortSignal; onProgress: (progress: CopyProgress) => void },
): Promise<CopyResponse> {
  const response = await fetch("/api/copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: CopyResponse | null = null;
  let latest: CopyProgress | null = null;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; error?: string; result?: CopyResponse } & CopyProgress;
      if (event.type === "progress") latest = event;
      else if (event.type === "error") throw new Error(event.error ?? "Copy failed.");
      else if (event.result) result = event.result;
    }
    if (latest) {
      options.onProgress(latest);
      latest = null;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    }
  }
  if (!result) throw new Error("The copy ended before a result was ready.");
  return result;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const RECENT_KEY = "folderdiff-recent-paths";

function readRecent(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 8);
  } catch {
    return [];
  }
}

function rememberPaths(paths: string[]): string[] {
  const next: string[] = [];
  for (const path of [...paths, ...readRecent()]) {
    const trimmed = path.trim();
    if (!trimmed || next.includes(trimmed)) continue;
    next.push(trimmed);
    if (next.length === 8) break;
  }
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

type PendingCopy = {
  from: string;
  to?: string;
  toRoot?: string;
  sourceRoot?: string;
  destRoot?: string;
  relativePath?: string;
  overwrite: boolean;
  kind: "file" | "directory";
  title: string;
  label: string;
};

type CopyProgress = {
  phase: "plan" | "copy" | "delete";
  done: number;
  total: number;
  path?: string;
};

type CopyPlan = {
  filesToCopy: number;
  filesToOverwrite: number;
  symlinksToCopy: number;
  skippedSymlinks: Array<{ path: string; reason: string }>;
  deletions: Array<{ relativePath: string; kind: string }>;
};

type CopyResponse = {
  filesCopied?: number;
  skippedSymlinks?: number;
  skippedSpecial?: number;
  symlinksCopied?: number;
  deleted?: number;
  overwritten?: boolean;
};
