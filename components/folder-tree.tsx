"use client";

import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";

import type { CompareEntry } from "@/lib/compare/types";
import { cn } from "cn";

import {
  STATUS_CLASS,
  STATUS_LABEL,
  buildTree,
  formatSize,
  visiblePaths,
  type StatusFilter,
} from "./compare-view";

export function FolderTree({
  entries,
  selected,
  expanded,
  onToggle,
  onSelect,
  nameQuery,
  statusFilter,
}: {
  entries: CompareEntry[];
  selected: string | null;
  expanded: Set<string>;
  onToggle: (relativePath: string) => void;
  onSelect: (entry: CompareEntry) => void;
  nameQuery: string;
  statusFilter: StatusFilter;
}) {
  const tree = buildTree(entries, visiblePaths(entries, statusFilter, nameQuery));
  if (tree.length === 0) {
    return (
      <p className="px-4 py-8 text-sm text-muted-foreground">
        Nothing matches this filter. Clear the name filter or switch back to Changes.
      </p>
    );
  }

  return (
    <div className="min-w-0" role="tree" aria-label="Folder comparison">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card/95 px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur">
        <span className="w-5 shrink-0" />
        <span className="w-24 shrink-0">Status</span>
        <span className="min-w-0 flex-1">Path</span>
        <span className="hidden w-16 shrink-0 text-right sm:block">Left</span>
        <span className="hidden w-16 shrink-0 text-right sm:block">Right</span>
      </div>
      <ul>
        {tree.map((node) => (
          <TreeRow
            key={node.entry.relativePath}
            node={node}
            depth={0}
            selected={selected}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  node: ReturnType<typeof buildTree>[number];
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onToggle: (relativePath: string) => void;
  onSelect: (entry: CompareEntry) => void;
}) {
  const { entry } = node;
  const isDirectory = entry.type === "directory";
  const isOpen = expanded.has(entry.relativePath);
  const isSelected = selected === entry.relativePath;

  return (
    <li role="treeitem" aria-expanded={isDirectory ? isOpen : undefined} aria-selected={isSelected}>
      <div
        className={cn(
          "flex w-full items-start gap-2 border-b border-border/70 px-2 py-1.5 text-left text-sm",
          isSelected ? "bg-accent" : "hover:bg-muted/70",
        )}
      >
        <button
          type="button"
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background"
          style={{ marginLeft: depth * 14 }}
          aria-label={isDirectory ? (isOpen ? `Collapse ${entry.name}` : `Expand ${entry.name}`) : entry.name}
          onClick={() => {
            if (isDirectory) onToggle(entry.relativePath);
            else onSelect(entry);
          }}
        >
          {isDirectory ? (
            isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />
          ) : entry.type === "symlink" ? (
            <span className="text-[10px]">↗</span>
          ) : (
            <File className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => {
            if (isDirectory) onToggle(entry.relativePath);
            onSelect(entry);
          }}
        >
          <span
            className={cn(
              "mt-0.5 inline-flex h-5 w-24 shrink-0 items-center justify-center rounded-full border px-1.5 text-[10px] font-medium",
              STATUS_CLASS[entry.status],
            )}
          >
            {STATUS_LABEL[entry.status]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {isDirectory ? <Folder className="size-3.5 shrink-0 text-muted-foreground" /> : null}
              <span className="truncate font-medium">{entry.name}</span>
            </span>
            {entry.relativePath !== entry.name ? (
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {entry.relativePath}
              </span>
            ) : null}
            {entry.error ? (
              <span className="mt-0.5 block text-xs text-destructive">{entry.error}</span>
            ) : null}
          </span>
          <span className="hidden w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted-foreground sm:block">
            {sideLabel(entry, "left")}
          </span>
          <span className="hidden w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted-foreground sm:block">
            {sideLabel(entry, "right")}
          </span>
        </button>
      </div>
      {isDirectory && isOpen ? (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.entry.relativePath}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function sideLabel(entry: CompareEntry, side: "left" | "right"): string {
  const stat = side === "left" ? entry.left : entry.right;
  if (!stat) return "—";
  if (stat.kind === "directory") return "dir";
  if (stat.kind === "symlink") return "link";
  return formatSize(stat.size);
}
