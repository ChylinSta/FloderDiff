import { describe, expect, it } from "vitest";

import { beginCopy, cancelCopy, isCopyId } from "./copy-session";

describe("copy cancel session", () => {
  it("aborts the copy signal without closing the request", () => {
    const request = new AbortController();
    const session = beginCopy("copy-id-1234", request.signal);
    expect(isCopyId("copy-id-1234")).toBe(true);
    expect(cancelCopy("copy-id-1234")).toBe(true);
    expect(session.signal.aborted).toBe(true);
    expect(request.signal.aborted).toBe(false);
    session.finish();
    expect(cancelCopy("copy-id-1234")).toBe(false);
  });

  it("aborts the copy when the request goes away", () => {
    const request = new AbortController();
    const session = beginCopy("copy-id-5678", request.signal);
    request.abort();
    expect(session.signal.aborted).toBe(true);
    session.finish();
  });
});