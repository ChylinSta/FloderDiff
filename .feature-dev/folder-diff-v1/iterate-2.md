# FolderDiff — Iterate 2

Run: `folder-diff-v1`  
Follows `iterate-1.md`.

## Fixed

1. **Copy a selected directory.** Left-only, right-only, and different folders can be copied to the other side. The confirm dialog says whether files already on the destination will be replaced. The source is not deleted. Files that exist only on the destination stay. The copy is planned before anything is written, so a refused overwrite does not change the destination. Symlinks inside the folder are skipped and counted. Special files are skipped and counted. The copy is refused when a path leaves the compare root, when the source and destination are the same path or one is inside the other, or when either path is a drive root.

2. **UTF-16 without a BOM.** Even-length samples of at least 8 bytes are treated as UTF-16 LE or BE when at least 80% of the pairs look like ASCII text in that endianness and the other endianness is clearly weaker. The decoded text must not contain replacement characters or unexpected control bytes. A short null, or a mixed binary buffer, stays binary. Text that is mostly outside ASCII, including much CJK UTF-16 without a BOM, also stays binary because the heuristic is not confident.

3. **Character-level highlight inside a changed token.** Word diff still finds the token. A paired replacement is then split with a character diff, so `value1` versus `value2` marks `1` and `2` and leaves `value` unmarked.

4. **README.** It states that there is no operating-system file dialog, and that the Windows opener, drive-letter browse, and symlink tests have not been verified on Windows.

## Tests

`npm test` — 50 passing. New cases cover directory copy (including extra destination files, refused overwrite, skipped symlinks, self-copy, and drive root), UTF-16 LE without a BOM, mixed binary staying binary, and the `value1` / `value2` character spans.

## Still rough

- Browse is still a directory listing. There is no native file dialog.
- Windows `start` and drive-letter browse are still untested on Windows.
- UTF-16 without a BOM is only detected for ASCII-heavy text.
- Copying a folder does not remove files that exist only on the destination, and it does not copy symlinks.
- A very large folder copy has no separate progress line of its own. The compare that follows uses the existing hashing status.
