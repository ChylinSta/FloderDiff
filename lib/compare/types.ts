export type EntryStatus =
  | "same"
  | "different"
  | "left-only"
  | "right-only"
  | "type-mismatch";

export type NodeKind = "file" | "directory" | "symlink" | "other";

export type SideStat = {
  kind: NodeKind;
  size: number;
  mtimeMs: number;
};

export type CompareEntry = {
  relativePath: string;
  name: string;
  type: NodeKind;
  status: EntryStatus;
  left?: SideStat;
  right?: SideStat;
  leftPath?: string;
  rightPath?: string;
  error?: string;
  leftHash?: string;
  rightHash?: string;
  /** Symlink text. Not followed. */
  leftTarget?: string;
  rightTarget?: string;
};

export type FolderSummary = Record<EntryStatus | "errors", number>;

export type FolderCompareResult = {
  leftRoot: string;
  rightRoot: string;
  patterns: string[];
  summary: FolderSummary;
  entries: CompareEntry[];
};

export type LineChange = "equal" | "insert" | "delete" | "change";

export type DiffRow = {
  change: LineChange;
  leftLine: number | null;
  rightLine: number | null;
  leftText: string | null;
  rightText: string | null;
};

export type DiffHunk = {
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
  rows: DiffRow[];
};

export type FileDiffResult = {
  kind: "text" | "binary";
  identical: boolean;
  lineEndingsDiffer: boolean;
  truncated: boolean;
  binaryReason?: "null-byte" | "invalid-utf8" | "too-large";
  leftBytes: number;
  rightBytes: number;
  leftHash: string;
  rightHash: string;
  counts: { equal: number; insert: number; delete: number; change: number };
  hunks: DiffHunk[];
};

export type BrowseEntry = {
  name: string;
  kind: NodeKind;
};

export type BrowseResult = {
  path: string;
  parent: string | null;
  roots: string[];
  entries: BrowseEntry[];
};

export type WalkEntry = {
  relativePath: string;
  name: string;
  kind: NodeKind;
  size: number;
  mtimeMs: number;
  target?: string;
};

export type WalkResult = {
  entries: Map<string, WalkEntry>;
  errors: Map<string, string>;
};
