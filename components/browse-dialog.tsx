"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { BrowseResult, PathDescription } from "@/lib/compare/types";

export function BrowseDialog({
  open,
  recent,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  recent: string[];
  onOpenChange: (open: boolean) => void;
  onPick: (path: string, kind: "file" | "directory", side: "left" | "right") => void;
}) {
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [fileCandidate, setFileCandidate] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const path = current;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = path ? `?path=${encodeURIComponent(path)}` : "";
        const response = await fetch(`/api/browse${query}`, { cache: "no-store" });
        const body = (await response.json()) as BrowseResult & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not list that folder.");
        if (!cancelled) {
          setListing(body);
          setPasted(body.path);
          setRecentFolders(rememberFolder(body.path));
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not list that folder.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setRecentFolders(readFolders());
        if (!next) setCurrent(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Browse this machine</DialogTitle>
          <DialogDescription>
            Type or paste a full path, then Go. This listing is not the operating-system file dialog.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void goTo(pasted, setCurrent, setFileCandidate, setError);
          }}
        >
          <Input
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="Type or paste a full path"
            className="font-mono"
            spellCheck={false}
            aria-label="Path to open"
          />
          <Button type="submit" variant="outline">
            Go
          </Button>
        </form>
        {fileCandidate ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">That path is a file.</span>
            <Button type="button" size="xs" onClick={() => onPick(fileCandidate, "file", "left")}>
              Use as left
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => onPick(fileCandidate, "file", "right")}>
              Use as right
            </Button>
          </div>
        ) : null}
        {recentFolders.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Recent folders</p>
            <div className="flex flex-wrap gap-1">
              {recentFolders.map((path) => (
                <Button key={path} type="button" size="xs" variant="outline" className="max-w-full" onClick={() => void goTo(path, setCurrent, setFileCandidate, setError)}>
                  <span className="truncate font-mono">{path}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {recent.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {recent.map((path) => (
              <Button key={path} type="button" size="xs" variant="ghost" className="max-w-full" onClick={() => void goTo(path, setCurrent, setFileCandidate, setError)}>
                <span className="truncate font-mono">{path}</span>
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {listing?.roots.map((root) => (
            <Button key={root} type="button" size="sm" variant="outline" onClick={() => setCurrent(root)}>
              {root}
            </Button>
          ))}
          {listing?.parent ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCurrent(listing.parent)}>
              Up
            </Button>
          ) : null}
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">{listing?.path ?? "Home"}</p>
        {listing ? (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" onClick={() => onPick(listing.path, "directory", "left")}>
              Use this folder as left
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onPick(listing.path, "directory", "right")}
            >
              Use this folder as right
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Listing…</p> : null}
        <div className="max-h-72 overflow-auto rounded-lg border">
          <ul>
            {listing?.entries.map((entry) => (
              <li key={entry.name} className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                  onClick={() => {
                    if (!listing) return;
                    const next = joinPath(listing.path, entry.name);
                    if (entry.kind === "directory") setCurrent(next);
                  }}
                >
                  <span className="mr-2 text-[10px] tracking-wide text-muted-foreground uppercase">
                    {entry.kind === "directory" ? "Dir" : entry.kind === "symlink" ? "Link" : "File"}
                  </span>
                  {entry.name}
                </button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    listing &&
                    onPick(
                      joinPath(listing.path, entry.name),
                      entry.kind === "directory" ? "directory" : "file",
                      "left",
                    )
                  }
                >
                  Left
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    listing &&
                    onPick(
                      joinPath(listing.path, entry.name),
                      entry.kind === "directory" ? "directory" : "file",
                      "right",
                    )
                  }
                >
                  Right
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function goTo(raw: string, setCurrent: (path: string) => void, setFileCandidate: (path: string | null) => void, setError: (message: string | null) => void) {
  const target = raw.trim();
  if (!target) return;
  setError(null);
  const response = await fetch(`/api/stat?path=${encodeURIComponent(target)}`, { cache: "no-store" });
  const body = (await response.json()) as PathDescription & { error?: string };
  if (!response.ok) {
    setError(body.error ?? "Could not read that path.");
    return;
  }
  if (!body.exists) {
    setFileCandidate(null);
    setError("Path not found.");
    return;
  }
  if (body.kind === "file") {
    setFileCandidate(body.path);
    return;
  }
  setFileCandidate(null);
  setCurrent(body.path);
}

const FOLDER_KEY = "folderdiff-recent-folders";

function readFolders(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDER_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 8);
  } catch {
    return [];
  }
}

function rememberFolder(folder: string): string[] {
  const next = [folder, ...readFolders().filter((item) => item !== folder)].slice(0, 8);
  localStorage.setItem(FOLDER_KEY, JSON.stringify(next));
  return next;
}

function joinPath(parent: string, name: string): string {
  if (parent.endsWith("\\") || parent.endsWith("/")) return `${parent}${name}`;
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent}${separator}${name}`;
}
