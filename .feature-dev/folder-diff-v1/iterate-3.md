# FolderDiff — Iterate 3

Run: `folder-diff-v1`  
Follows `iterate-2.md`.

## Changed

1. **Folder copy progress.** Copying streams newline-delimited progress (`plan`, `copy`, `delete`) with files done/total and the current path. The page shows a copper **Copying n / n** line and **Cancel** while the request is open. Cancel stops the copy; files already written stay, and the folder compare runs afterward. A fast copy keeps the copying line on screen together with the hashing line that follows.

2. **Optional mirror.** The default is unchanged: destination-only files stay, and the source is not deleted. The folder confirm dialog has an explicit checkbox to remove files and folders that exist only on the destination. The dialog shows the count and example paths, and says FolderDiff cannot undo that. Deletions are planned before anything is removed. A symlink on the destination is unlinked and not followed. The existing refusals remain: path escapes the compare root, one side sits inside the other, and drive roots.

3. **Symlinks.** The default still skips symlinks. A second checkbox recreates the link text when the target exists and stays inside the source compare root, and the recreated link would stay inside the destination compare root. Links that escape or whose target is missing are skipped and reported. They are not dereferenced.

4. **UTF-16 without a BOM.** Detection now accepts a clean decode in one endianness, not only ASCII with NUL bytes. Chinese fixtures `fixtures/files/zh-utf16le.txt` and `fixtures/files/zh-utf16be.txt` decode as text. Valid UTF-8, a short null, an odd-length buffer, and mixed binary stay binary or UTF-8.

5. **Browse.** Still an in-app listing, not an OS file dialog. The path field is editable, Go navigates to a pasted path, recent folders are remembered, and drive letters are still listed when the server is Windows. The README says there is no OS dialog and that Windows `start` and drive-letter browse have not been run on Windows.

The CLI has no copy command. `folderdiff files` uses the same encoding detection, so the UTF-16 change applies there.

## Tested

`npm test` — 56 passing. New cases cover copy progress and cancel, mirror on and off, not following a destination symlink while deleting, recreating an internal symlink, skipping an escaping symlink, Chinese UTF-16 LE/BE fixtures without a BOM, and negative binary cases.

Browser on Linux at `http://127.0.0.1:43123`: Chinese UTF-16 diff highlights `。` versus `！`; the folder dialog lists `keep-me.txt` and the irreversible warning; after confirm the page shows `Copying 13 / 13` and `Finished hashing 13 / 13`; Browse Go and Recent folders work.

## Still rough

- There is no operating-system file dialog.
- Windows `start` and drive-letter browse are still untested on Windows.
- A cancelled copy does not roll back files already written.
- Mirror delete is permanent from the app.
- UTF-16 without a BOM is rejected when both endiannesses look equally like text, or when the sample is shorter than 8 bytes.
- The copying line stays until the next compare you start yourself, so it can sit above a later hashing line.
