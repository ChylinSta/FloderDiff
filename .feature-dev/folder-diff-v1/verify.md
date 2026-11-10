# FolderDiff — Verify

Run: `folder-diff-v1`  
Date: 2026-11-10  
Command host: Linux, Node.js 22

## Automated

`npm test` — pass. 31 tests, 3 files:

- `lib/compare/folder.test.ts` — classification, rollup, symlinks, binary hashes, missing root, unreadable directory, fixture categories
- `lib/compare/text-diff.test.ts` — identical, change, insert, delete, context hunk, CRLF, binary, invalid UTF-8, trailing newline, sample files
- `lib/compare/ignore.test.ts` — defaults, nested `node_modules`, `*.log`, prefix safety, multiple patterns, empty list, invalid `[`

CLI smoke (exit 0):

```text
npm run folderdiff -- dirs fixtures/left fixtures/right
Same 2 · Different 4 · Left only 1 · Right only 2
different      assets/logo.bin
right-only     nested/extra.txt
different      notes.log
different      README.md
left-only      src/only-left.ts
right-only     src/only-right.ts
different      src/util.ts

npm run folderdiff -- files fixtures/files/left.txt fixtures/files/right.txt
Change 1 · Insert 1 · Delete 1
```

`node_modules` and `.DS_Store` are absent from that listing. `notes.log` stays visible until `*.log` is added.

HTTP smoke against `http://127.0.0.1:43123`:

| Check | Result |
| --- | --- |
| `GET /api/fixtures` | absolute fixture paths |
| `POST /api/compare` fixtures | summary same 2, different 4, left-only 1, right-only 2 |
| `POST /api/diff` sample text | change beta/BETA, delete delta, insert iota |
| `POST /api/diff` logo.bin | `kind: binary`, `binaryReason: null-byte`, no hunks |
| missing folder | 404, message names the path |
| `GET /api/browse?path=/workspace/fixtures` | lists `files`, `left`, `right` |
| `POST /api/open` on `fixtures/files/left.txt` | 200 `{ ok: true }` and the host opened the file |
| `GET /` | 200, page includes FolderDiff |

`npx tsc --noEmit` and eslint on the app and library — pass.

## Manual smoke

Browser, desktop ~1280px and a 390×800 viewport. The dev server was already bound to 127.0.0.1:43123.

| Step | Result |
| --- | --- |
| Empty state explains the tool and offers sample folders and sample files | Pass |
| Sample folders, Changes filter: different / left-only / right-only rows match the fixture; `node_modules` hidden; same files hidden until All | Pass |
| `src/util.ts` line diff highlights `return 1` vs `return 2` | Pass |
| `assets/logo.bin` shows sizes and SHA-256, no text dump | Pass |
| `src/only-left.ts` explains there is no right-hand file; right-side actions disabled | Pass |
| Name filter `only-right` keeps that file and its parent | Pass |
| Adding `*.log` and comparing again drops `notes.log`; removing it brings the file back | Pass |
| Sample files: change, insert, and delete counts and colors | Pass |
| Missing path shows “Path does not exist” and leaves the page usable | Pass |
| Browse lists a directory, sets the left path, and closes | Pass |
| Copy left shows “Copied the path.” Open left shows “Asked the system to open that path.” | Pass |
| 390px: folder drill-in has “Back to folders”; file diff stacks and scrolls inside the page | Pass |

## Iteration after the first pass

The first browser pass worked, and three layout issues were still obvious:

- File mode kept the two-column folder grid, so the text diff sat in a narrow left column.
- Tree column titles did not sit on the same grid as the rows, and a top-level file repeated its name as the path.
- `h-dvh` plus the dev indicator crowded the phone layout. The page now scrolls as a document below the `lg` breakpoint, and the dev indicator is off.

Re-checked in the browser after that change: the sample text diff spans the content width, folder headers line up with the rows, and the footer does not cover the tree. Unit tests still pass.

## Not verified here

- Windows `cmd.exe /c start` was not executed. The spawn path is the one in `lib/compare/open.ts`. Linux `xdg-open` did launch.
- A multi-gigabyte tree was not walked. Hashes are streamed, but a huge directory will hold the HTTP request until the walk finishes.
