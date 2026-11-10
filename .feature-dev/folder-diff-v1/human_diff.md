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
7. **Binary sniff.** A null byte or invalid UTF-8 becomes “binary” with no line diff. UTF-16 text will look binary. A short text file with a null in it will too.
8. **Read-only on purpose.** There is no copy-left-to-right, delete, or merge. If a button ever writes, that is a bug.
9. **Binding.** The server is meant for `127.0.0.1` only. Do not put it behind a public proxy. Anyone who can reach the port can read files as the user running Node.

## Rough edges left on purpose

- Browse is a directory listing, not the operating system’s file dialog.
- The CLI exits 0 when differences exist. It is a viewer, not a CI gate.
- Replaced lines are highlighted as a whole line. There is no character-level highlight inside the line.
- Identical text files show a match banner and do not paint every unchanged line.
- Default ignores are `node_modules`, `.git`, and `.DS_Store`. `*.log` is opt-in. Clearing the ignore field compares everything, including dependency folders.
