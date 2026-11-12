# FolderDiff — Requirements

Run: `folder-diff-v1`  
Product name: **FolderDiff** (not a Beyond Compare clone; no trademarked assets or names in the UI)

## Problem

People comparing two directories or two text files need a fast, local, side-by-side view of what is only on one side, what matches, and what changed. Command-line `diff -r` is accurate but hard to scan. A small cross-platform tool should make that scan obvious.

## Stack choice

**Local web UI (Next.js, TypeScript, Tailwind, shadcn/ui) + a shared TypeScript comparison core + a Node CLI.**

Why this and not Electron or Tauri for the MVP:

- One language for the engine, tests, HTTP API, CLI, and UI.
- Filesystem access stays on the machine that launches the server. The dev and production servers bind to `127.0.0.1`.
- No Rust toolchain and no Electron packaging step, so Linux and Windows installs are `Node.js + npm`.
- The core has no React dependency, so tests and the CLI exercise the same code the UI calls.

Electron or Tauri can wrap this later. The comparison rules do not depend on the shell.

## Users

- A developer comparing a copy of a project, a backup, or two export folders.
- Someone who wants a readable text diff without opening an IDE.
- Someone who wants a scriptable check (`folderdiff dirs A B`) in addition to the UI.

## MVP scope

### 1. File compare

- Load two filesystem paths and show them side by side.
- Highlight line-level **insert**, **delete**, and **change** (a replaced line is a change, not only a delete plus an insert).
- Show line numbers, a short summary (counts), and a banner when the files are identical.
- Normalize `\r\n` and `\n` for line alignment. If the bytes differ only by line endings, say so.
- **Binary** (or undecodable) files: do not throw. Report binary / identical-or-different using size and a content hash. Do not render a fake text diff.
- Very large text files: compare and classify them, but cap the rendered line count and say the view was truncated.

### 2. Folder compare

- Recursively compare two directories.
- Each file is one of: **same**, **different**, **left-only**, **right-only**.
- A path that is a file on one side and a directory on the other is **type-mismatch** (shown with the differing group).
- Directories roll up: a directory is **same** only when every compared descendant is **same**; otherwise it is **different**, or left-only / right-only when the directory itself exists on only one side.
- The UI shows a tree, defaulting to interesting rows (not a wall of identical files), with filters for all / different / left-only / right-only / same.
- Choosing a file row opens the file diff for that relative path.
- Symlinks are recorded as symlinks and are **not** followed (no cycles, no escape from the chosen roots).

### 3. Actions

- **Refresh** re-reads both sides.
- **Open** sends the selected path to the system default application (`xdg-open` on Linux, `cmd /c start` on Windows, `open` on macOS) without a shell-concatenated command.
- **Copy path** copies the absolute path of the selected side (or both) to the clipboard.
- **Name filter** keeps rows whose relative path contains the query (case-insensitive).
- **Ignore patterns** skip matches such as `node_modules`, `.git`, and `*.log`. Defaults are `node_modules`, `.git`, and `.DS_Store`. Patterns apply to path segments and to globs against the relative POSIX path.
- **Browse** lists a directory so a path can be chosen without a native file dialog (the page is a local site, not a packaged OS shell).

### 4. Fixtures and CLI

- `fixtures/left` and `fixtures/right` demonstrate every folder status, ignore rules, and a binary file.
- `fixtures/files/` has a text pair with insert, delete, and change.
- CLI: `folderdiff dirs <left> <right>` and `folderdiff files <left> <right>`, with `--ignore` and `--json`.

### 5. Quality bar

- Automated tests cover folder classification, text diff hunks, and ignore patterns.
- Empty, loading, and error states exist in the UI (missing path, permission, file-vs-directory mistake).
- Layout works on a desktop width (primary) and a narrow width (panes stack).
- README documents install and run for Linux and Windows. License is MIT.

## Non-goals

- Binary visual diff, hex viewer, image compare, or archive peeking.
- Three-way merge, patch apply, copy/sync/delete between sides, or “reconcile” actions that write files. This version is read-only aside from launching the OS open handler.
- Edit-in-place, syntax highlighting, or language-aware parsing.
- Ignore-whitespace, ignore-case, or external diff rules beyond line-ending normalization.
- Authentication, multi-user hosting, or a remote filesystem. Binding beyond localhost is unsupported.
- Git integration (blame, history, or `.gitignore` import). Ignore patterns are explicit.
- Packaging installers (`.deb`, MSI, Electron Builder). Running via Node is the supported install.
- Following symlinks, comparing special files (devices, sockets), or handling paths the OS user cannot read (those surface as errors on that entry or as a request error).
- Trademarked Beyond Compare names, icons, colors copied as a brand, or session-file compatibility.

## Success criteria

- Folder compare of the sample fixture trees shows the correct categories.
- Text diff of the sample fixture files highlights insert, delete, and change.
- Tests for walk classification, text hunks, and ignore patterns pass.
- README is enough for a Linux or Windows user with Node.js 20+ to install, run the UI, and run the CLI.
- A human can spot-check the items in `human_diff.md`.

## Assumptions

- Node.js 20 or newer is available.
- The person running the server is allowed to read the paths they type. FolderDiff does not elevate.
- “Desktop-capable” means a local app with filesystem access and an OS “open” action, delivered as a localhost UI plus CLI, not a packaged native shell in this version.
- The human design-review gate is waived for this autonomous run (see `design_review.md`).
