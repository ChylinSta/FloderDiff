import type { CompareEntry, EntryStatus } from "@/lib/compare/types";

export type StatusFilter = "changes" | "all" | EntryStatus;

export type TreeNode = {
  entry: CompareEntry;
  children: TreeNode[];
};

export function entryMatchesStatus(entry: CompareEntry, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "changes") return entry.status !== "same";
  if (filter === "different") {
    return entry.status === "different" || entry.status === "type-mismatch";
  }
  return entry.status === filter;
}

export function visiblePaths(
  entries: CompareEntry[],
  filter: StatusFilter,
  query: string,
): Set<string> {
  const needle = query.trim().toLowerCase();
  const visible = new Set<string>();

  const addParents = (relativePath: string) => {
    const parts = relativePath.split("/");
    let accumulated = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!part) continue;
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      visible.add(accumulated);
    }
  };

  for (const entry of entries) {
    const nameOk = !needle || entry.relativePath.toLowerCase().includes(needle);
    if (!nameOk || !entryMatchesStatus(entry, filter)) continue;
    visible.add(entry.relativePath);
    addParents(entry.relativePath);
  }

  return visible;
}

export function buildTree(entries: CompareEntry[], visible: Set<string>): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const sorted = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
  for (const entry of sorted) {
    if (!visible.has(entry.relativePath)) continue;
    const node: TreeNode = { entry, children: [] };
    nodes.set(entry.relativePath, node);
    const slash = entry.relativePath.lastIndexOf("/");
    const parent = slash === -1 ? undefined : nodes.get(entry.relativePath.slice(0, slash));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function defaultExpanded(entries: CompareEntry[]): Set<string> {
  const expanded = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "directory") continue;
    const depth = entry.relativePath.split("/").length;
    if (entries.length < 400 || depth < 2) expanded.add(entry.relativePath);
  }
  return expanded;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  same: "Same",
  different: "Different",
  "left-only": "Left only",
  "right-only": "Right only",
  "type-mismatch": "Type mismatch",
};

export const STATUS_CLASS: Record<EntryStatus, string> = {
  same: "border-stone-300 bg-stone-100 text-stone-700",
  different: "border-amber-300 bg-amber-100 text-amber-950",
  "left-only": "border-sky-300 bg-sky-100 text-sky-950",
  "right-only": "border-violet-300 bg-violet-100 text-violet-950",
  "type-mismatch": "border-rose-300 bg-rose-100 text-rose-950",
};
