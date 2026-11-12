# FolderDiff — Design

Run: `folder-diff-v1`

## Architecture

```
browser (React UI)
    │  HTTP only to 127.0.0.1
    ▼
Next.js route handlers
    │  thin validation, path checks
    ▼
lib/compare          ← same code
    ▲
cli/folderdiff.ts
```

| Piece | Role |
| --- | --- |
| `lib/compare` | Ignore rules, directory walk, classification, text and binary diff. No React, no Next. |
| `app/api/*` | JSON adapters: browse, compare directories, diff files, open with the OS. |
| `app/page.tsx` + `components/` | Two-pane UI. |
| `cli/folderdiff.ts` | `dirs` and `files` commands for terminals and CI. |
| `fixtures/` | Deterministic trees and text files used by the UI sample buttons and by docs. |
| Vitest | Unit tests import `lib/compare` only. They build temp directories where the fixture tree is not enough. |

The dev server and `next start` bind to `127.0.0.1` on port **43123** (override with `PORT`). The UI never receives raw directory listings except for paths the local user asked to browse.

### Why route handlers, not a second server

One process reads the disk and serves the UI. The CLI does not start Next; it calls the library. That keeps “what is different” identical in tests, CLI JSON, and the page.

## UX wire notes

Desktop, top to bottom:

```
┌ FolderDiff ─────────────────────────────────────────────────────┐
│  Compare files and folders on this machine.                     │
│  [ Folders ] [ Files ]                         Refresh           │
├──────────────────────────────┬──────────────────────────────────┤
│ Left path  [..............]  │ Right path [..............]      │
│ [Browse] [Use sample]        │ [Browse] [Use sample]            │
├──────────────────────────────┴──────────────────────────────────┤
│ Ignore [node_modules, .git, .DS_Store        ]  Name [filter ]  │
│ Show: All | Different | Left only | Right only | Same           │
├─────────────────────────────────────────────────────────────────┤
│ TREE (folder mode)                                              │
│  status   path                         left size    right size  │
│  ≠        src/util.ts                  120          148         │
│  ←        src/only-left.ts             40           —           │
│  →        nested/extra.txt             —            20          │
│  =        src/app.ts                   80           80          │
│  click a file → file diff                                       │
├─────────────────────────────────────────────────────────────────┤
│ FILE DIFF                                                       │
│  banner: 2 changes, 1 insert, 1 delete                          │
│  left 1  const a = 1        │ right 1  const a = 1              │
│  left 2  const b = 2        │ right 2  const b = 3     change   │
│  left —                     │ right 3  const extra     insert   │
│  [Copy left path] [Copy right path] [Open left] [Open right]    │
└─────────────────────────────────────────────────────────────────┘
```

Narrow width: path cards stack, then the diff panes stack (left above right). The tree becomes a single column with status and path; sizes move under the path.

Visual language:

- Stone background, ink text, one copper accent for primary buttons. Not a purple marketing page.
- Status chips: same = stone, different = amber, left-only = sky, right-only = violet, type-mismatch = rose.
- Diff rows: delete = rose wash on the left, insert = green wash on the right, change = amber wash on both, equal = transparent.
- Monospace for paths and diff text. UI chrome uses a sans stack.

States:

- **Empty:** short instructions and two sample actions (fixture folders, fixture files). No fake data until the user asks.
- **Loading:** the tree or diff area shows a quiet “Reading both sides…” line and disables Refresh.
- **Error:** the API message (not a stack) in the page, with the path that failed.
- **Binary:** a panel with sizes and hashes, and the sentence “Binary files are not line-diffed.”
- **Truncated text:** a banner with the line cap.

Browse is a small dialog: parent link, directory names, and “Set as left” / “Set as right”. Files in that listing can be set as a file-compare path. This replaces a native file picker, which a localhost page cannot reliably open on both Linux and Windows without a desktop shell.

## Data model

### Ignore

```ts
type IgnoreList = {
  /** Raw patterns as the user typed them, minus blanks. */
  patterns: string[];
};

function shouldIgnore(relativePosixPath: string, patterns: string[]): boolean;
```

Rules:

1. If a pattern contains no glob character and no slash, ignore the path when any segment equals the pattern. `node_modules` ignores `node_modules` and `node_modules/pkg/index.js` anywhere in the tree. `git` does not ignore `.git` or `github.txt`.
2. If a pattern contains a slash but no glob character, ignore the path when it equals the pattern or starts with `pattern/`. `src/generated` ignores that folder and its children.
3. Otherwise match the pattern with picomatch against the full relative POSIX path and against the basename. `*.log` ignores `notes.log` and `sub/notes.log`.
4. Matching is case-sensitive so tests are stable. `Node_Modules` is not ignored by `node_modules` unless the user adds it. The walker emits POSIX relative paths even on Windows.
5. The root directories themselves are never ignored; patterns apply to descendants.
6. Compare results include `leftPath` and `rightPath` (absolute) on each entry so the UI can copy, open, and diff without rejoining paths in the browser.

### Walk node (internal)

```ts
type WalkEntry = {
  relativePath: string; // POSIX, "" only for the root (not emitted)
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;         // bytes for files; 0 for directories
  mtimeMs: number;
};
```

`walkTree(root, patterns)` returns a `Map<relativePath, WalkEntry>`.

- Uses `fs.readdir` with file types. Does not follow symlinks. A symlink is stored as `kind: "symlink"` with its own path and is not descended into.
- `other` (socket, fifo, device) is kept so the classifier can mark it instead of crashing.
- Unreadable directories become an error entry rather than failing the whole compare: `{ relativePath, error: string }` collected beside the map.

### Folder compare (API and CLI)

```ts
type EntryStatus =
  | "same"
  | "different"
  | "left-only"
  | "right-only"
  | "type-mismatch";

type SideStat = {
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mtimeMs: number;
};

type CompareEntry = {
  relativePath: string;
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  status: EntryStatus;
  left?: SideStat;
  right?: SideStat;
  error?: string;
  /** Present when a file's bytes were hashed. */
  leftHash?: string;
  rightHash?: string;
};

type FolderCompareResult = {
  leftRoot: string;
  rightRoot: string;
  patterns: string[];
  summary: Record<EntryStatus | "errors", number>;
  entries: CompareEntry[]; // directories and files, sorted by relativePath
};
```

Classification:

| Left | Right | Rule |
| --- | --- | --- |
| file | file | SHA-256 equal → `same`, else `different`. Hash streamed; files are not loaded fully into a string. |
| symlink | symlink | same target text → `same`, else `different`. Targets are not followed. |
| other | other | same size → still `different` unless size is equal **and** we can hash; if the kind is not a regular file, status is `different` when both exist (we do not pretend devices match). Simpler rule: non-regular, non-symlink pairs are `different` if both exist, unless both are symlinks. |
| directory | directory | emitted after children are known. `same` iff every descendant entry is `same` or there are no descendants. `different` if any descendant is not `same` or any descendant has an error. |
| present | absent | `left-only` or `right-only`. Parent directories that exist only because of an only-one-side child still exist on both sides when the parent folder exists on both; the child carries the only-one status. |
| file | directory (or other kind mismatch) | `type-mismatch`. |

Summary counts **files, symlinks, and type-mismatches**, not directories, so a folder of three identical files reports `same: 3` rather than inflating the count with every parent. Directory rows still exist for the tree. Errors increment `errors` and do not also increment a status bucket.

Sort: `relativePath` with `/` so children group under parents (`src` before `src/app.ts` is not guaranteed by plain code-point sort because `/` sorts before letters... actually `/` is before most characters so `src` < `src/app.ts`. Good. `src-old` vs `src/a`: `-` (0x2D) < `/` (0x2F), so `src-old` < `src/a`. Acceptable for MVP.)

### File diff

```ts
type DiffKind = "text" | "binary" | "identical";

type LineChange = "equal" | "insert" | "delete" | "change";

type DiffRow = {
  change: LineChange;
  leftLine: number | null;   // 1-based
  rightLine: number | null;
  leftText: string | null;
  rightText: string | null;
};

type DiffHunk = {
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
  rows: DiffRow[];
};

type FileDiffResult = {
  kind: "text" | "binary";
  identical: boolean;
  lineEndingsDiffer: boolean;
  truncated: boolean;
  binaryReason?: "null-byte" | "invalid-utf8" | "too-large";
  leftBytes: number;
  rightBytes: number;
  leftHash: string;
  rightHash: string;
  counts: { equal: number; insert: number; delete: number; change: number };
  hunks: DiffHunk[];
};
```

Text pipeline:

1. Read up to a byte cap (default 1_000_000 bytes per file) for the diff view. Over the cap: if the sample looks binary, return binary `too-large`; if it looks like text, still hash the full file for `identical`, but build hunks only from the first cap and set `truncated`. Folder classification always hashes the full file and does not use this cap.
2. Binary detection on the bytes used for display: if a `0x00` byte is present, or `TextDecoder` with `fatal: true` throws, kind is `binary`. Identical binaries (`leftHash === rightHash`) set `identical: true` and return no hunks.
3. Decode UTF-8. Record whether either original buffer contained `\r\n`. Split on `\n` after stripping a trailing newline so a final EOL does not invent an extra empty line. Compare line arrays with a line LCS (`diff` package).
4. Walk the LCS script. A run of deletions immediately followed by a run of insertions (or the reverse, normalized to delete-then-insert) is zipped into **change** rows for `min(len)` lines. Leftovers stay **delete** or **insert**.
5. Context hunks: group changed rows with up to 3 equal context lines on each side. A gap of more than 6 equal lines splits hunks. Identical files return `identical: true`, `hunks: []`, and counts of equal lines (the UI can still request nothing to paint, and shows “Files match.”).

`lineEndingsDiffer` is true when hashes differ and the normalized line arrays are equal.

### HTTP API

All routes accept JSON or query strings as noted. Paths are absolute, or relative to `process.cwd()`. The handler resolves them with `path.resolve` and rejects empty paths.

| Method | Path | Body / query | Result |
| --- | --- | --- | --- |
| `GET` | `/api/browse?path=` | absolute directory; empty means the platform home, plus a `roots` list | `{ path, parent, roots, entries: { name, kind }[] }` |
| `POST` | `/api/compare` | `{ left, right, patterns?: string[] }` | `FolderCompareResult` |
| `POST` | `/api/diff` | `{ left, right }` | `FileDiffResult` |
| `POST` | `/api/open` | `{ path }` | `{ ok: true }` or 400 |

Errors: `400` for a missing body or a path that is the wrong kind (file vs directory). `404` when a path does not exist. `500` only for unexpected throws; the message stays short.

`/api/open` uses `spawn` (no `shell: true`):

- Linux: `xdg-open <path>`
- Windows: `cmd.exe /c start "" <path>`
- macOS: `open <path>`

It does not wait for the editor to exit. If the helper is missing, return 500 with “Could not launch the system opener.”

### CLI

```
folderdiff dirs <left> <right> [--ignore pat]... [--json]
folderdiff files <left> <right> [--json]
```

Human output is a short summary plus one line per non-same file entry. `--json` prints the library result. Exit code `0` when the compare ran, including when differences exist (this is a viewer, not a CI gate). Exit code `1` for usage or IO failures. A future `--fail-on-diff` is out of scope.

### UI state

One client component holds:

```ts
type Mode = "folders" | "files";
type Session = {
  mode: Mode;
  left: string;
  right: string;
  patternsText: string;
  nameQuery: string;
  statusFilter: "all" | EntryStatus;
  folder?: FolderCompareResult;
  diff?: FileDiffResult;
  selectedRelativePath?: string;
  error?: string;
  loading: boolean;
};
```

Sample buttons fill the paths with the fixture directories resolved by `GET /api/fixtures` (returns absolute paths so the UI does not guess the working directory).

Name filter and status filter run client-side on `folder.entries`. A directory stays visible when the filter matches it or any descendant. “Different” filter includes `different` and `type-mismatch`.

### Security notes (local tool)

- Listen on `127.0.0.1` only.
- Do not shell out with string concatenation.
- Do not follow symlinks.
- The server can read anything the OS user can read. That is the product. README states it plainly. Do not expose the port on a LAN.

## File layout (planned)

```
app/
  layout.tsx
  page.tsx
  globals.css
  api/browse/route.ts
  api/compare/route.ts
  api/diff/route.ts
  api/open/route.ts
  api/fixtures/route.ts
components/
  compare-app.tsx
  path-bar.tsx
  browse-dialog.tsx
  folder-tree.tsx
  file-diff.tsx
lib/compare/
  ignore.ts
  walk.ts
  folder.ts
  text-diff.ts
  hash.ts
  open.ts
  types.ts
  index.ts
cli/folderdiff.ts
fixtures/...
vitest.config.ts
```

## Test strategy

See `testcases.md`. Tests cover the library, not the React tree. UI behavior is checked with a manual smoke checklist in `verify.md` against the running server.
