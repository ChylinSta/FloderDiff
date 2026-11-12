const COPY_ID = /^[A-Za-z0-9-]{8,80}$/;

const copies = new Map<string, AbortController>();

export type CopySession = {
  signal: AbortSignal;
  finish: () => void;
};

/**
 * A copy keeps its HTTP response open so it can report rollback after Cancel.
 * The browser posts the same id to /api/copy/cancel instead of aborting the fetch.
 * If the browser disconnects, the request signal still aborts the copy.
 */
export function beginCopy(copyId: string | undefined, requestSignal: AbortSignal): CopySession {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (requestSignal.aborted) controller.abort();
  else requestSignal.addEventListener("abort", onAbort);
  if (copyId) copies.set(copyId, controller);
  return {
    signal: controller.signal,
    finish() {
      requestSignal.removeEventListener("abort", onAbort);
      if (copyId) copies.delete(copyId);
    },
  };
}

export function cancelCopy(copyId: string): boolean {
  if (!COPY_ID.test(copyId)) return false;
  const controller = copies.get(copyId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isCopyId(copyId: string): boolean {
  return COPY_ID.test(copyId);
}
