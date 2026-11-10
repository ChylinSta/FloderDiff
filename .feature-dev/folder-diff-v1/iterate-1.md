# FolderDiff — Iterate 1

Run: `folder-diff-v1`  
Follows `verify.md` and `human_diff.md`.

## Fixed

1. **CLI exit codes.** `folderdiff dirs` and `folderdiff files` exit **0** when both sides match, **2** when the compare finds a difference (including line-ending-only bytes and unreadable entries), and **1** for usage errors or a missing root. `--json` still prints the result first. Documented in the README. Covered by `lib/compare/exit-code.test.ts`, which also spawns the CLI.

2. **Folder compare no longer waits for the whole hash before the page can update.** `POST /api/compare` streams newline-delimited JSON: `progress` events while walking and hashing, then a `result` or an `error`. The page shows a progress bar and a **Cancel** button. Cancel aborts the request; the walk and hash check that signal and stop. Small trees finish so quickly the bar only flashes.

3. **Word-level highlight inside a changed line.** Changed rows carry `leftSpans` and `rightSpans` from a word diff (whitespace kept). The line still has the amber wash; the changed word is a darker mark. Example: `return 1` versus `return 2` highlights `1` and `2`.

4. **Copy between sides.** A selected regular file that is left-only, right-only, or different gets **Copy left to right** and/or **Copy right to left**. File mode offers both directions when the two files differ. The dialog says whether the destination will be created or overwritten. The copy refuses directories, symlinks, and a relative path that leaves the destination folder. After a successful copy the compare refreshes.

5. **UTF-16 BOM.** A leading `FF FE` or `FE FF` is decoded as UTF-16 LE or BE and line-diffed. A UTF-8 BOM is stripped. If the decoded lines match but the encodings differ, the banner says so and the CLI still exits 2 because the bytes differ. UTF-16 without a BOM still looks binary.

6. **Path browse.** Each path field checks the path and shows Folder, File, Missing, or Symlink. Recent paths (last eight successful compares, four shown) can be sent to either side. The browse dialog accepts a pasted path and jumps to that folder, or offers Left/Right when the paste is a file.

## Tests

`npm test` — 43 passing, including the new exit-code, encoding, inline-highlight, copy, and progress/cancel cases.

## Still rough

- No operating-system folder picker. Browse is still a listing.
- UTF-16 without a BOM is still treated as binary.
- Character-level diffs inside a single word are not split further than words (`value1` versus `value2` highlights the whole token).
- Copy does not copy directories, and it does not delete the source.
- A tiny tree still finishes in well under a second. The copper status line stays after the compare (“Finished hashing n / n”) until the next compare, and Cancel is on that line while the request is open.
- Windows `start` and drive-letter browse are still untested on Windows.
- A cancelled compare keeps whatever result was already on screen; it does not roll back a partial copy. Copy itself is one file and finishes before the refresh.
