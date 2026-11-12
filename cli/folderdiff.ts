import { parseArgs } from "node:util";

import { CompareError, compareFolders, diffFiles, fileExitCode, folderExitCode } from "../lib/compare";
import type { FileDiffResult, FolderCompareResult } from "../lib/compare";

function usage(): void {
  console.error(`FolderDiff

Usage:
  folderdiff dirs <left> <right> [--ignore pattern]... [--no-ignore] [--json]
  folderdiff files <left> <right> [--json]

Exit codes:
  0  both sides match
  1  usage error, or a root path is missing or unreadable
  2  the compare finished and found a difference
`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "dirs" && command !== "files") {
    usage();
    process.exitCode = 1;
    return;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      ignore: { type: "string", multiple: true },
      "no-ignore": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length !== 2) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (values["no-ignore"] && values.ignore && values.ignore.length > 0) {
    console.error("Use either --no-ignore or --ignore, not both.");
    process.exitCode = 1;
    return;
  }

  const [left, right] = positionals;
  if (!left || !right) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === "dirs") {
    const patterns = values["no-ignore"] ? [] : values.ignore;
    const result = await compareFolders(left, right, patterns);
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else printFolders(result);
    process.exitCode = folderExitCode(result);
    return;
  }

  const result = await diffFiles(left, right);
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else printFiles(result, left, right);
  process.exitCode = fileExitCode(result);
}

function printFolders(result: FolderCompareResult): void {
  const { summary } = result;
  console.log(`Left   ${result.leftRoot}`);
  console.log(`Right  ${result.rightRoot}`);
  console.log(
    `Same ${summary.same} · Different ${summary.different} · Left only ${summary["left-only"]} · Right only ${summary["right-only"]} · Type mismatch ${summary["type-mismatch"]} · Errors ${summary.errors}`,
  );
  if (result.patterns.length > 0) {
    console.log(`Ignore ${result.patterns.join(", ")}`);
  }
  const interesting = result.entries.filter(
    (entry) => entry.type !== "directory" && entry.status !== "same",
  );
  if (interesting.length === 0) {
    console.log("No differing files.");
    return;
  }
  for (const entry of interesting) {
    console.log(`${entry.status.padEnd(14)} ${entry.relativePath}${entry.error ? `  (${entry.error})` : ""}`);
  }
}

function printFiles(result: FileDiffResult, left: string, right: string): void {
  console.log(`Left   ${left}`);
  console.log(`Right  ${right}`);
  if (result.kind === "binary") {
    console.log(
      result.identical
        ? "Binary files match."
        : `Binary files differ (${result.binaryReason ?? "binary"}).`,
    );
    return;
  }
  if (result.identical) {
    console.log(`Text files match (${result.counts.equal} lines).`);
    return;
  }
  if (result.lineEndingsDiffer) {
    console.log("Bytes differ only by line endings. Line text matches.");
    return;
  }
  console.log(
    `Change ${result.counts.change} · Insert ${result.counts.insert} · Delete ${result.counts.delete}`,
  );
  for (const hunk of result.hunks) {
    console.log(
      `@@ -${hunk.leftStart},${hunk.leftCount} +${hunk.rightStart},${hunk.rightCount} @@`,
    );
    for (const row of hunk.rows) {
      const mark = row.change === "insert" ? "+" : row.change === "delete" ? "-" : row.change === "change" ? "~" : " ";
      const text = row.change === "insert" ? row.rightText : row.leftText;
      console.log(`${mark} ${text ?? ""}`);
      if (row.change === "change") console.log(`+ ${row.rightText ?? ""}`);
    }
  }
}

main().catch((error: unknown) => {
  if (error instanceof CompareError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unknown error");
  }
  process.exitCode = 1;
});
