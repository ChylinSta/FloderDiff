# FolderDiff — Design review

Run: `folder-diff-v1`  
Reviewers (this autonomous run): product perspective and engineering perspective, both written before implementation.  
**Human gate: waived.** No person is in the loop for this run. The waiver is intentional so implementation can start. Residual risks below are accepted for the MVP, with the mitigations listed.

## Product perspective

The job is “see what changed between two folders or two files” in one sitting. The design does that if the first screen can load the fixtures in one click and the tree answers four questions without a legend hunt: only left, only right, same, different.

What is right:

- Read-only. A compare tool that can also copy and delete on day one will be feared and will not get used for backups.
- Sample fixtures. Pasting absolute paths is hostile; the sample action proves the product before the user points it at a real tree.
- Change rows, not only insert/delete. Replacements are the common case in source files, and a paired highlight is what people mean by “diff.”
- Binary files get a calm refusal instead of garbage characters.

What is thin, and accepted for MVP:

- No native file dialog. Browse-by-listing is slower than an OS picker. It is still usable, and path fields accept paste, which is how many people already grab a path from a terminal.
- Filters are client-side. Fine for fixture-sized and typical project trees. A huge monorepo will feel slow; that is called out as a risk, not solved with virtualization in v1.
- Identical files hide their hunks. The banner is enough. Showing thousands of equal lines would bury the next action.
- No “copy left to right.” Users who need a sync tool should not get a half-built one here.

Product risks:

1. **Trust.** If one status is wrong, the whole tool is discarded. Mitigation: classification tests on a temp tree that covers same, different, both orphans, type mismatch, symlink non-follow, and ignore. Fixtures match those rules so the UI smoke check and the tests agree.
2. **Ignore surprise.** Default ignores hide `node_modules` and `.git`. A user comparing those folders on purpose will see an empty-looking tree. Mitigation: show the active patterns next to the filter and an empty-state sentence when every entry was ignored or filtered out.
3. **Line endings.** Exact byte compare marks CRLF vs LF as different, while the text view may say the lines match. That can look like a bug. Mitigation: `lineEndingsDiffer` banner, documented in the UI copy.

## Engineering perspective

The split between `lib/compare` and Next is the maintainable part. Route handlers should stay boring: resolve paths, call one function, map errors to status codes.

What is right:

- Streaming SHA-256 for folder equality avoids reading two large files into strings just to decide “same.”
- Symlinks are not followed. That removes a class of infinite walks and a class of “compare escaped the root” bugs.
- `spawn` without a shell for the opener. Paths with spaces and quotes stay arguments.
- Tests do not boot Next. They will still run if the UI kit changes.

Engineering risks:

| Risk | Severity | Mitigation in v1 | Follow-up if it hurts |
| --- | --- | --- | --- |
| Walking a huge tree blocks the Node event loop and the HTTP request | Medium | Document practical size. Compare is a single request. Ignore defaults cut common noise. | Stream NDJSON or move the walk to a worker. |
| Hashing many large binaries is slow | Medium | Stream hashes. UI shows a loading state. No parallel fan-out that could spike memory. | Hash size+mtime as a fast path with an explicit “trust timestamps” option. Not in v1, because timestamps lie. |
| Binary sniff false positive on UTF-16 or a text file that contains a null | Low | Null byte or invalid UTF-8 → binary. UTF-16 will look binary. Say that in the binary panel. | Encoding selector. |
| Binary sniff false negative on a short non-UTF-8 file with no null | Low | `TextDecoder` fatal mode still catches invalid UTF-8. | Treat known extensions as binary only as a hint, never as the only signal. |
| Path access from another user on a shared machine hitting the port | Medium | Bind `127.0.0.1` only. README says not to reverse-proxy it. | Refuse a non-loopback `Host` if we ever add auth. Out of scope. |
| `cmd /c start` mishandles Windows paths | Medium | Argument vector `start`, empty title, raw path. Manual note in `human_diff.md` because this environment is Linux. | Verify on a Windows machine before calling the opener done. |
| Picomatch pattern that throws or is pathological | Low | Catch and return 400 “Invalid ignore pattern.” Limit pattern count (32) and length (200). | — |
| Directory read error mid-tree failing the whole compare | Medium | Record `error` on that entry, continue siblings. | — |
| UI and library drift | Low | UI consumes the JSON types only. No second classifier in the client. | — |

### Adversarial review

**Not run.** Highest residual risk is medium (localhost filesystem read by design, opener spawn, large-tree denial of service against one’s own server). None of these are “high” once the server binds to loopback and does not use a shell. An adversarial pass would be warranted if the service were reachable off-box or if compare could write. It cannot.

Waiver recorded: proceed to test cases and implementation without a human approval step and without an adversarial stage.

## Decisions locked before coding

1. Product name is FolderDiff. MIT license.
2. Stack is Next.js + `lib/compare` + Node CLI. Port 43123. Host `127.0.0.1`.
3. Equality is full-content SHA-256, not size and mtime.
4. Symlinks are compared as links and never followed.
5. Replaced lines zip into `change` rows.
6. Default ignore list: `node_modules`, `.git`, `.DS_Store`.
7. Exit code of the CLI does not signal “differences found.”
8. No write/sync actions in this version.
