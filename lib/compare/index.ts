export { browseDirectory, platformRoots } from "./browse";
export { assertSafeCopy, copyFileTo, copyPath, copyTree, resolveInsideRoot } from "./copy";
export { decodeSample, encodingLabel, sniffEncoding, sniffUtf16WithoutBom } from "./encoding";
export { CompareError } from "./errors";
export { fileExitCode, folderExitCode } from "./exit-code";
export { fixturePaths } from "./fixtures";
export { compareFolders } from "./folder";
export type { CompareOptions } from "./folder";
export { hashFile } from "./hash";
export { compileIgnore, DEFAULT_IGNORE } from "./ignore";
export { inlineSpans } from "./inline";
export { openInSystem } from "./open";
export { diffFiles, splitLines } from "./text-diff";
export type {
  BrowseResult,
  CompareEntry,
  CompareProgress,
  DiffHunk,
  DiffRow,
  EntryStatus,
  FileDiffResult,
  FolderCompareResult,
  FolderSummary,
  InlineSpan,
  LineChange,
  NodeKind,
  PathDescription,
  TextEncoding,
} from "./types";
