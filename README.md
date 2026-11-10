# FolderDiff

FolderDiff compares two folders or two files on your machine and shows the result side by side. Folder results are **same**, **different**, **left only**, **right only**, or **type mismatch**. Text files open into a line diff with inserts, deletes, and changes. Binary files are reported as binary instead of being dumped as text.

This is an independent tool. It is not Beyond Compare and does not use that product's name, icon, or session format.

## Stack

The interface is a local **Next.js** app (TypeScript, Tailwind, shadcn/ui). Comparison rules live in `lib/compare`, which the page, the HTTP routes, the CLI, and the tests all call.

A localhost web app plus a Node CLI was chosen over Electron or Tauri so the project stays one language, has no native toolchain, and runs the same way on Linux and Windows: install Node.js, install dependencies, start the server. The server binds to **127.0.0.1** only. It can read any path your user can read. Copying a file to the other side happens only after you confirm. It does not delete files.

## Requirements

- Node.js 20 or newer
- npm

Check with `node -v`.

## Run the app on Linux

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

`npm run dev` starts Next.js on port **43123** and host **127.0.0.1**. Override the port with `PORT` only if you also pass it through to Next, or edit the `dev` script. Do not expose this port on a LAN. There is no login screen because the process can see your files.

Production mode on the same host and port:

```bash
npm run build
npm start
```

## Run the app on Windows

Install Node.js 20 or newer from [https://nodejs.org](https://nodejs.org), then in **Command Prompt** or **PowerShell**, from this folder:

```bat
npm install
npm run dev
```

Open http://127.0.0.1:43123 in a browser on the same PC.

Paths can be pasted either as `C:\Users\me\left` or `C:/Users/me/left`. Use **Browse** to list drives and folders if you would rather not type them. **Open left** / **Open right** launches the Windows default app with `cmd.exe /c start "" <path>` (no shell-concatenated string).

The CLI uses the same path style:

```bat
npm run folderdiff -- dirs C:\compare\left C:\compare\right
npm run folderdiff -- files C:\compare\a.txt C:\compare\b.txt --json
```

## What you can do

- Compare two folders recursively. Click a file to drill into it.
- Compare two text files, with change, insert, and delete highlighting. Inside a changed word, only the changed characters are marked (`value1` versus `value2` highlights `1` and `2`).
- See a binary file called out as binary when it contains a null byte or is not valid UTF-8. UTF-16 LE and UTF-16 BE are shown as text when a byte-order mark is present, or when the bytes are even-length and clearly look like ASCII stored as UTF-16. Other UTF-16, including text that is mostly not ASCII, stays binary.
- Refresh, copy a path, copy a file or a selected folder from one side to the other, and open a path in the system default application (`xdg-open` on Linux, `start` on Windows, `open` on macOS). Copying a folder adds and overwrites files. It does not delete files that exist only on the destination, and it does not delete the source. Symlinks inside the folder are skipped.
- Watch folder compare progress (walking, then hashing) and cancel it. The page stays usable while that runs.
- Paste a path, pick a recent path, and see whether the path is a folder, a file, or missing before you compare.
- Filter the folder tree by name.
- Ignore names such as `node_modules` or `.git`, or globs such as `*.log`. Defaults are `node_modules`, `.git`, and `.DS_Store`. Clear the ignore field to compare everything. `*.log` is not ignored until you add it.
- Load the sample trees under `fixtures/left` and `fixtures/right`, or the sample text pair under `fixtures/files/`.

Symlinks are listed and compared as links. They are not followed.

Line endings are normalized for the text view. If the bytes differ only by CRLF versus LF, or by a trailing newline, FolderDiff says so instead of painting every line as a change. Folder equality itself is a SHA-256 of the raw bytes, so those files still count as different in the tree.

## CLI

```bash
npm run folderdiff -- dirs fixtures/left fixtures/right
npm run folderdiff -- dirs fixtures/left fixtures/right --ignore node_modules --ignore "*.log" --json
npm run folderdiff -- dirs fixtures/left fixtures/right --no-ignore
npm run folderdiff -- files fixtures/files/left.txt fixtures/files/right.txt
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Both sides match. |
| 1 | Usage error, or a root path is missing or unreadable. |
| 2 | The compare finished and found a difference. Line-ending-only changes and unreadable entries inside a tree count as a difference. |

`--json` still prints the result before the process exits. A script can read the JSON and also branch on the exit code.

## Limits

FolderDiff does not open the operating-system file dialog. **Browse** lists directories, and you can paste a path. A native picker would need a desktop shell, which this version does not include.

The server is developed and checked on Linux. These Windows behaviors are implemented and untested on a Windows machine:

- **Open** launches `cmd.exe /c start "" <path>`.
- **Browse** looks for drive letters `A:\` through `Z:\`.
- Creating a symlink in the automated tests is skipped when the OS refuses the link.

Do not expose port 43123 beyond localhost. The process can read files as the user running Node, and it can copy a file or folder after you confirm.

## Tests

```bash
npm test
```

Vitest covers folder classification (including the sample fixtures), text diff hunks, and ignore patterns. The cases are listed in `.feature-dev/folder-diff-v1/testcases.md`.

## Feature-dev notes

The design record for this version is in `.feature-dev/folder-diff-v1/`:

- `requirements.md`
- `design.md`
- `design_review.md` (human review gate waived for the autonomous run)
- `testcases.md`
- `verify.md`
- `human_diff.md`
- `iterate-1.md`
- `iterate-2.md`

## License

MIT. See [LICENSE](LICENSE).
