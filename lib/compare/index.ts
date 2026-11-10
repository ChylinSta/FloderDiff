export { browseDirectory, platformRoots } from "./browse";
export { CompareError } from "./errors";
export { fixturePaths } from "./fixtures";
export { compareFolders } from "./folder";
export { hashFile } from "./hash";
export { compileIgnore, DEFAULT_IGNORE } from "./ignore";
export { openInSystem } from "./open";
export { diffFiles, splitLines } from "./text-diff";
export type {
  BrowseResult,
  CompareEntry,
  DiffHunk,
  DiffRow,
  EntryStatus,
  FileDiffResult,
  FolderCompareResult,
  FolderSummary,
  LineChange,
  NodeKind,
} from "./types";
