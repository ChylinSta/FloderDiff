# FolderDiff — Iterate 4

Run: `folder-diff-v1`  
Follows `iterate-3.md`. Requirements and design were not rewritten.

## Changed

1. **Cancel rolls back that copy.** Canceling a copy removes files, folders, and symlinks that copy created, and puts back files it overwrote or destination-only files it had started to remove. Files that were already on the destination, and that this copy did not write, stay. The copy response stays open so the page can show that report. If a path cannot be undone, the notice starts with `Partial copy` and names those paths. Cancel takes effect between files. A file that has already been written is included in the rollback.

2. **The copying line clears when the copy ends.** Success, cancel, and error all clear it before the compare that follows. It is not shown together with the hashing line.

3. **Windows path paste.** `C:\Users\me\compare\left`, `C:/Users/me/compare/left`, and `D:\data` normalize to the same Windows path rules, including quotes and a trailing slash. `C:` is that drive’s root. Drive-letter browse still lists `A:\` through `Z:\` when the server is Windows, and falls back to `C:\` when none are visible. Open is still `cmd.exe /c start "" <path>` with the path as one argument. `start.cmd` now exits if Node is missing or older than 20, then runs `npm run dev`.

4. **UTF-16 without a BOM.** A 4- or 6-byte sample is text only when every pair is ASCII in exactly one endianness. A 2-byte sample stays binary. When both endiannesses look equally like text, detection does not guess.

## Tested

`npm test` — 75 passing. The new cases are in `copy.test.ts`, `copy-route.test.ts`, `paths.test.ts`, `browse.test.ts`, `open.test.ts`, `copy-session.test.ts`, and `encoding.test.ts`.

Browser on Linux at `http://127.0.0.1:43123`. The folder dialog states what cancel does. After a sample folder copy the page showed `Copied 3 files.` under `Finished hashing 7 / 7`, with no copying line. Canceling a 2500-file copy during planning left the destination unchanged and said nothing from that copy was left behind.

## Still rough

- There is no operating-system file dialog.
- Open, drive-letter browse, and `start.cmd` have not been executed on a real Windows machine. The `start` arguments are checked with a mock.
- A finished mirror copy still deletes destination-only files permanently. Cancel can put those files back only when the removal is still in this request’s rollback.
- UTF-16 without a BOM stays binary for a sample shorter than 4 bytes, and when both endiannesses look equally like text.
- A special destination node that is not a file or a symlink cannot be restored. That path is reported as a partial copy.
