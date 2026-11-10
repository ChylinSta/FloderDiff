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
import type { BrowseResult } from "@/lib/compare/types";

export function BrowseDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (path: string, kind: "file" | "directory", side: "left" | "right") => void;
}) {
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

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
        if (!cancelled) setListing(body);
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
        if (!next) setCurrent(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Browse this machine</DialogTitle>
          <DialogDescription>
            Pick a folder or file. FolderDiff only lists paths your user can read.
          </DialogDescription>
        </DialogHeader>
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

function joinPath(parent: string, name: string): string {
  if (parent.endsWith("\\") || parent.endsWith("/")) return `${parent}${name}`;
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent}${separator}${name}`;
}
