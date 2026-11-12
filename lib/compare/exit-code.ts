import type { FileDiffResult, FolderCompareResult } from "./types";

/** 0 when both sides match. 2 when any compared file differs or a path could not be read. */
export function folderExitCode(result: FolderCompareResult): 0 | 2 {
  const summary = result.summary;
  const differences =
    summary.different +
    summary["left-only"] +
    summary["right-only"] +
    summary["type-mismatch"] +
    summary.errors;
  return differences > 0 ? 2 : 0;
}

/** 0 when the bytes match. 2 when they do not, including line-ending-only differences. */
export function fileExitCode(result: FileDiffResult): 0 | 2 {
  return result.identical ? 0 : 2;
}
