# FolderDiff — Human spot-check

Run: `folder-diff-v1`  
The autonomous review gate was waived in `design_review.md`. This list is what a person should still look at before trusting the tool on their own machine.

## What already passed here

- `npm test` (31 tests): folder categories, text hunks, ignore rules, and the committed fixtures.
- Browser pass on Linux against `http://127.0.0.1:43123`: sample folders, sample text diff (change / insert / delete), binary panel, name filter, `*.log` ignore, missing-path error, browse, copy path, open path, and a 390px-wide layout.
- CLI `dirs` and `files` on the fixtures.

## Please look at these

1. **Windows open.** `Open left` / `Open right` on Linux used `xdg-open` and returned success. On Windows the code spawns `cmd.exe /c start "" <path>` without a shell string. Confirm a path with spaces opens in the default app and does not open a blank console that steals focus.
2. **Windows browse.** Drive letters are detected with `existsSync("C:\\")` and so on. Confirm Browse lists the drives you expect and that `C:\...` paths compare the same as `C:/...`.
3. **Symlinks.** They are compared as link text and never followed. Creating them in the test is skipped if the OS refuses the symlink. On a Windows checkout without symlink privilege, confirm a link shows up as a symlink row instead of being walked or crashing.
4. **Line endings.** Two files that differ only by CRLF vs LF are **different** in the folder tree (raw SHA-256) and show a banner in the file view rather than a wall of changes. Confirm that banner matches what you wanted. If you needed byte-identical to mean “same text,” the tree will still say different.
5. **Ignore case.** `node_modules` does not ignore `Node_Modules`. Add the exact name if you are on a case-insensitive volume and the folder is capitalized differently.
6. **A tree you care about.** The sample trees are tiny. Point FolderDiff at two real project copies, refresh, and check one file you already know is different. A huge tree holds the request until the walk and hashes finish. There is no progress bar.
7. **Binary sniff.** A null byte or invalid UTF-8 becomes “binary” with no line diff. UTF-16 **with a BOM** is text. UTF-16 without a BOM still looks binary. A short text file with a null in it will too.
8. **Copy writes.** Copy left to right and copy right to left ask before they overwrite. There is still no delete. If a copy happens without the confirm dialog, that is a bug.
9. **Binding.** The server is meant for `127.0.0.1` only. Do not put it behind a public proxy. Anyone who can reach the port can read files as the user running Node, and can copy a file after confirming.

## Rough edges left on purpose

- Browse is a directory listing with paste and recent paths, not the operating system’s file dialog.
- The CLI exits 2 when a difference exists and 0 when both sides match. See `iterate-1.md`.
- Changed lines highlight the changed words. Identical text files still show a match banner and do not paint every unchanged line.
- Default ignores are `node_modules`, `.git`, and `.DS_Store`. `*.log` is opt-in. Clearing the ignore field compares everything, including dependency folders.
- Folder compare streams progress and can be cancelled. A very large tree still spends the time hashing; the page should stay responsive while that runs.

## Iterate 4

- Canceling a copy should remove files that copy created and restore files it overwrote. A file that was already on the destination, and that this copy did not write, should still be there. If the notice starts with “Partial copy”, those named paths were left behind on purpose.
- The copying line should disappear before hashing starts.
- UTF-16 without a BOM still needs a human look on a real file. Two-byte samples and text that looks valid in both endiannesses stay binary.
- Windows Open, drive-letter browse, and `start.cmd` are still not verified on a Windows machine.
