# FolderDiff — Test cases

Run: `folder-diff-v1`  
Automated tests live beside the library and run with `npm test` (Vitest). They use temporary directories created per test, plus the committed fixtures where a stable tree is useful.

Pass bar: `npm test` exits 0. The cases below are the ones the implementation must cover. Names in parentheses are the planned test titles.

## 1. Folder walk classification

Setup helper: write a temp pair of roots.

| Case | Left | Right | Expected |
| --- | --- | --- | --- |
| Identical file (`classifies identical files as same`) | `a.txt` = `hello` | `a.txt` = `hello` | file `a.txt` status `same`, summary.same ≥ 1 |
| Changed file (`classifies changed files as different`) | `a.txt` = `hello` | `a.txt` = `hello!` | `different` |
| Only left (`classifies files that exist only on the left`) | `only-left.txt` | — | `left-only`, no right stat |
| Only right (`classifies files that exist only on the right`) | — | `only-right.txt` | `right-only` |
| Nested same path (`classifies nested files by relative path`) | `sub/n.txt` = `x` | `sub/n.txt` = `x` | `sub/n.txt` is `same` |
| Type mismatch (`flags a file vs directory type mismatch`) | `box` file | `box` directory | `type-mismatch` |
| Directory rollup (`rolls directory status up from children`) | `sub/a.txt` same, `sub/b.txt` different | matching paths | directory `sub` is `different`; a parent of only-same children is `same` |
| Summary ignores directory rows (`counts files, not directories, in the summary`) | two same files in a folder | same | `summary.same === 2` |
| Symlink not followed (`does not follow symlinks or walk through them`) | `link` → `a.txt`, and `secret/hidden.txt` outside | a matching or differing link | `link` is a symlink entry; `secret/hidden.txt` is absent; no throw if the target is outside the root |
| Unreadable / missing root (`fails when a root is missing`) | path does not exist | a real directory | throws a clear error the API can map to 404 |
| Binary vs text bytes (`hashes binary files without reading them as strings`) | file containing `0x00` | same bytes | `same`; different bytes → `different` |

Fixture check (`fixture trees match the documented categories`):

Compare the committed `fixtures/left` and `fixtures/right` with default ignores.

Expected file statuses:

- `README.md` — different
- `docs/note.txt` — same
- `src/app.ts` — same
- `src/util.ts` — different
- `src/only-left.ts` — left-only
- `src/only-right.ts` — right-only
- `assets/logo.bin` — different
- `nested/extra.txt` — right-only
- `notes.log` — different (present; `*.log` is not a default pattern)
- anything under `node_modules/` — absent
- `.DS_Store` — absent

`.git` is not committed under `fixtures/` (a nested `.git` directory confuses the outer repository). Coverage for `.git` stays in the default-pattern unit test, which builds a temp tree. A second fixture assertion (`sample ignore can also drop logs`) compares the same trees with defaults plus `*.log` and expects `notes.log` to disappear.

## 2. Text diff hunks

| Case | Input | Expected |
| --- | --- | --- |
| Identical (`reports identical text with no hunks`) | `a\nb\n` vs `a\nb\n` | `identical`, `hunks.length === 0`, `kind === "text"` |
| Change (`pairs a replacement as a change row`) | `alpha\nbeta\n` vs `alpha\nBETA\n` | one change row, left `beta`, right `BETA`, counts.change === 1 |
| Insert (`marks a line that exists only on the right as insert`) | `a\nc\n` vs `a\nb\nc\n` | one insert row `b` between two equals (inside the hunk) |
| Delete (`marks a line that exists only on the left as delete`) | `a\nb\nc\n` vs `a\nc\n` | one delete row `b` |
| Mixed hunk (`builds a hunk with context around a change`) | several equal lines plus one change in the middle | hunk contains the change and at most 3 context lines on each side |
| Line endings (`flags CRLF vs LF when the lines otherwise match`) | `a\nb\n` vs `a\r\nb\r\n` | `identical === false` for the bytes (hashes differ) OR `lineEndingsDiffer === true` and the line rows are not a full-file change. Locked behavior: `lineEndingsDiffer === true`, `counts.change === 0`, `counts.insert === 0`, `counts.delete === 0`, and `identical === false` |
| Binary null (`does not build text hunks for a null byte`) | buffer with `0x00` vs a different buffer with `0x00` | `kind === "binary"`, `hunks.length === 0`, no throw |
| Binary identical (`reports identical binaries`) | same bytes including `0x00` | `kind === "binary"`, `identical === true` |
| Invalid UTF-8 (`treats invalid UTF-8 as binary`) | `0xff 0xfe` vs `0xff 0xfd` | `kind === "binary"` |
| Trailing newline (`does not invent a phantom empty line`) | `hello\n` vs `hello` | either identical lines with `lineEndingsDiffer` or a single coherent result that does not show two content changes. Locked behavior: line arrays are `["hello"]` and `["hello"]`, so no insert/delete/change; `lineEndingsDiffer` reflects the byte difference |
| Fixture files (`diffs the sample text fixtures`) | `fixtures/files/left.txt` and `right.txt` | at least one `change`, one `insert`, and one `delete` |

## 3. Ignore patterns

| Case | Patterns | Tree | Expected kept / dropped |
| --- | --- | --- | --- |
| Defaults (`default patterns skip node_modules, .git, and .DS_Store`) | defaults | those dirs plus `src/a.ts` | only `src/a.ts` |
| Segment anywhere (`ignores a named directory at any depth`) | `node_modules` | `pkg/node_modules/x.js` and `pkg/index.js` | only `pkg/index.js` |
| Glob (`ignores star-dot-log`) | `*.log` | `a.log`, `sub/b.log`, `sub/c.ts` | only `sub/c.ts` |
| Does not ignore partial names (`does not treat a prefix as a directory name`) | `git` | `.git/config`, `github.txt` | `.git/config` dropped by a **different** pattern in the defaults test; for pattern `git` alone, `.git` is **not** ignored and `github.txt` is **not** ignored |
| Multiple (`applies every pattern`) | `dist`, `*.tmp` | `dist/a.js`, `x.tmp`, `src/a.ts` | only `src/a.ts` |
| Empty pattern list (`keeps everything when patterns are empty`) | `[]` | `node_modules/a.js` | file is present. Callers that want defaults must pass them. The folder API uses defaults when `patterns` is omitted, and an empty array means “ignore nothing.” |

## 4. Not automated in v1 (manual, recorded in verify.md)

- Browse dialog lists a directory and sets a path.
- Refresh re-reads after a fixture is already on screen.
- Copy path writes to the clipboard (may be limited in a headless browser; note the result).
- Open calls the opener API and returns 200 for a real file. Do not fail the suite if `xdg-open` has no desktop to attach to; the route must return a controlled error or success, never an unhandled 500 stack in the UI.
- Narrow viewport stacks the diff panes.
- Name filter hides non-matching rows and keeps a parent directory of a matching child.

## 5. Commands

```bash
npm test
npm run diff -- dirs fixtures/left fixtures/right --json
npm run diff -- files fixtures/files/left.txt fixtures/files/right.txt
```
