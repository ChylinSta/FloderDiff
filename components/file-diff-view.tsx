"use client";

import { Button } from "@/components/ui/button";
import type { FileDiffResult, InlineSpan, LineChange } from "@/lib/compare/types";

export function FileDiffView({
  diff,
  heading,
  note,
  leftPath,
  rightPath,
  loading,
  onCopy,
  onOpen,
  fileCopy,
}: {
  diff: FileDiffResult | null;
  heading: string;
  note?: string;
  leftPath?: string;
  rightPath?: string;
  loading: boolean;
  onCopy: (path: string) => void;
  onOpen: (path: string) => void;
  fileCopy?: {
    leftToRight: boolean;
    rightToLeft: boolean;
    onCopy: (direction: "left-to-right" | "right-to-left") => void;
  };
}) {
  return (
    <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-card" aria-label="File diff">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{heading}</h2>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {leftPath ? `Left ${leftPath}` : "Left —"}
              <span className="px-1.5 text-border">/</span>
              {rightPath ? `Right ${rightPath}` : "Right —"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={!leftPath} onClick={() => leftPath && onCopy(leftPath)}>
              Copy left
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!rightPath} onClick={() => rightPath && onCopy(rightPath)}>
              Copy right
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!leftPath} onClick={() => leftPath && onOpen(leftPath)}>
              Open left
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!rightPath} onClick={() => rightPath && onOpen(rightPath)}>
              Open right
            </Button>
            {fileCopy?.leftToRight ? (
              <Button type="button" size="sm" onClick={() => fileCopy.onCopy("left-to-right")}>
                Copy left to right
              </Button>
            ) : null}
            {fileCopy?.rightToLeft ? (
              <Button type="button" size="sm" onClick={() => fileCopy.onCopy("right-to-left")}>
                Copy right to left
              </Button>
            ) : null}
          </div>
        </div>
        {diff ? <DiffSummary diff={diff} /> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !diff ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">Reading both sides…</p>
        ) : note ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">{note}</p>
        ) : diff?.kind === "binary" ? (
          <BinaryPanel diff={diff} />
        ) : diff && diff.hunks.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            {diff.identical
              ? "There is no line diff to paint."
              : diff.lineEndingsDiffer
                ? "Line text matches, so the panes stay quiet."
                : diff.truncated
                  ? "The portion that was line-diffed matches. The files are still not byte-identical."
                  : "There is no line diff to paint."}
          </p>
        ) : diff ? (
          <div>
            <div className="sticky top-0 z-10 hidden grid-cols-[3.25rem_minmax(12rem,1fr)_3.25rem_minmax(12rem,1fr)] border-b bg-muted/80 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:grid">
              <span className="px-2 py-1 text-right">Ln</span>
              <span className="px-2 py-1">Left</span>
              <span className="px-2 py-1 text-right">Ln</span>
              <span className="px-2 py-1">Right</span>
            </div>
            {diff.hunks.map((hunk, hunkIndex) => (
              <div key={`${hunk.leftStart}-${hunk.rightStart}-${hunkIndex}`}>
                <div className="bg-muted/50 px-3 py-1 font-mono text-[11px] text-muted-foreground">
                  @@ -{hunk.leftStart},{hunk.leftCount} +{hunk.rightStart},{hunk.rightCount} @@
                </div>
                {hunk.rows.map((row, rowIndex) => (
                  <div key={`${hunkIndex}-${rowIndex}`}>
                    <div className="diff-grid hidden md:grid">
                      <span className="diff-gutter px-2 text-right">{row.leftLine ?? ""}</span>
                      <span className={cellClass(row.change, "left")}>
                        <LineText text={row.leftText} spans={row.leftSpans} />
                      </span>
                      <span className="diff-gutter px-2 text-right">{row.rightLine ?? ""}</span>
                      <span className={cellClass(row.change, "right")}>
                        <LineText text={row.rightText} spans={row.rightSpans} />
                      </span>
                    </div>
                    <div className="border-b border-border/70 md:hidden">
                      <div className={cellClass(row.change, "left")}>
                        <span className="diff-gutter mr-2 inline-block w-8 text-right">{row.leftLine ?? ""}</span>
                        <LineText text={row.leftText} spans={row.leftSpans} />
                      </div>
                      <div className={cellClass(row.change, "right")}>
                        <span className="diff-gutter mr-2 inline-block w-8 text-right">{row.rightLine ?? ""}</span>
                        <LineText text={row.rightText} spans={row.rightSpans} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            Select a file to see its line diff. Identical files stay quiet. Binary files are marked and not line-diffed.
          </p>
        )}
      </div>
    </section>
  );
}

function DiffSummary({ diff }: { diff: FileDiffResult }) {
  if (diff.kind === "binary") {
    return (
      <p className="text-sm">
        {diff.identical ? "Binary files match." : "Binary files differ."}{" "}
        <span className="text-muted-foreground">FolderDiff does not line-diff them.</span>
      </p>
    );
  }
  if (diff.identical) {
    return (
      <p className="text-sm">
        These files match. {diff.counts.equal} lines are the same.
        <EncodingNote diff={diff} />
      </p>
    );
  }
  if (diff.encodingsDiffer && diff.hunks.length === 0) {
    return (
      <p className="text-sm">
        The line text matches. The files use different encodings ({labelEncoding(diff.leftEncoding)} and{" "}
        {labelEncoding(diff.rightEncoding)}).
      </p>
    );
  }
  if (diff.lineEndingsDiffer) {
    return (
      <p className="text-sm">
        Bytes differ only by line endings (CRLF versus LF, or a trailing newline). The line text matches.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <Count label="Change" value={diff.counts.change} className="diff-change" />
      <Count label="Insert" value={diff.counts.insert} className="diff-insert" />
      <Count label="Delete" value={diff.counts.delete} className="diff-delete" />
      {diff.encodingsDiffer ? (
        <span className="rounded-full border px-2 py-1 text-muted-foreground">
          {labelEncoding(diff.leftEncoding)} / {labelEncoding(diff.rightEncoding)}
        </span>
      ) : null}
      {diff.truncated ? (
        <span className="rounded-full border px-2 py-1 text-muted-foreground">
          Truncated to the first 1,000,000 bytes
        </span>
      ) : null}
    </div>
  );
}

function Count({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <span className={`rounded-full border border-transparent px-2 py-1 ${className}`}>
      {label} {value}
    </span>
  );
}

function BinaryPanel({ diff }: { diff: FileDiffResult }) {
  return (
    <div className="space-y-3 px-4 py-6 text-sm">
      <p>
        Binary files are not line-diffed. A null byte or bytes that are not valid UTF-8 stops the text view. UTF-16
        with a byte-order mark is shown as text.
      </p>
      <dl className="max-w-3xl space-y-3 font-mono text-xs">
        <div className="flex flex-wrap gap-8">
          <div>
            <dt className="text-muted-foreground">Left size</dt>
            <dd>{diff.leftBytes} bytes</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Right size</dt>
            <dd>{diff.rightBytes} bytes</dd>
          </div>
        </div>
        <div>
          <dt className="text-muted-foreground">Left SHA-256</dt>
          <dd className="break-all">{diff.leftHash}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Right SHA-256</dt>
          <dd className="break-all">{diff.rightHash}</dd>
        </div>
      </dl>
    </div>
  );
}

function LineText({ text, spans }: { text: string | null; spans?: InlineSpan[] }) {
  if (!spans || spans.length === 0) return <>{text ?? ""}</>;
  return spans.map((span, index) => (
    <span
      key={`${span.change}-${index}`}
      className={span.change === "delete" ? "diff-token-delete" : span.change === "insert" ? "diff-token-insert" : undefined}
    >
      {span.text}
    </span>
  ));
}

function EncodingNote({ diff }: { diff: FileDiffResult }) {
  if (diff.leftEncoding === "utf-8" && diff.rightEncoding === "utf-8") return null;
  return <span className="text-muted-foreground"> Read as {labelEncoding(diff.leftEncoding)}.</span>;
}

function labelEncoding(encoding: FileDiffResult["leftEncoding"]): string {
  if (encoding === "utf-16le") return "UTF-16 LE";
  if (encoding === "utf-16be") return "UTF-16 BE";
  return "UTF-8";
}

function cellClass(change: LineChange, side: "left" | "right"): string {
  const base = "diff-cell min-h-6 px-2";
  if (change === "change") return `${base} diff-change`;
  if (change === "delete") return side === "left" ? `${base} diff-delete` : `${base} diff-empty`;
  if (change === "insert") return side === "right" ? `${base} diff-insert` : `${base} diff-empty`;
  return base;
}
