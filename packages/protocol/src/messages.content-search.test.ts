import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("workspace.content_search RPC", () => {
  test("parses the request through the inbound union", () => {
    const request = {
      type: "workspace.content_search.request",
      cwd: "/repo",
      query: "needle",
      limit: 60,
      requestId: "content-search-1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("accepts a request without the optional limit", () => {
    const request = {
      type: "workspace.content_search.request",
      cwd: "/repo",
      query: "needle",
      requestId: "content-search-2",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test.each([0, 61, 1.5])("rejects out-of-range limit %s", (limit) => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "workspace.content_search.request",
        cwd: "/repo",
        query: "needle",
        limit,
        requestId: "content-search-invalid-limit",
      }).success,
    ).toBe(false);
  });

  test("parses the response through the outbound union", () => {
    const response = {
      type: "workspace.content_search.response",
      payload: {
        matches: [{ path: "src/app.ts", line: 2, preview: "// needle here" }],
        truncated: true,
        elapsedMs: 12,
        requestId: "content-search-1",
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("accepts an empty match list", () => {
    const response = {
      type: "workspace.content_search.response",
      payload: { matches: [], truncated: false, elapsedMs: 3, requestId: "content-search-3" },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("rejects malformed match rows and missing truncation reporting", () => {
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "workspace.content_search.response",
        payload: {
          matches: [{ path: "src/app.ts", line: 0, preview: "zero-based line" }],
          truncated: false,
          elapsedMs: 1,
          requestId: "content-search-bad-line",
        },
      }).success,
    ).toBe(false);
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "workspace.content_search.response",
        payload: {
          matches: [],
          elapsedMs: 1,
          requestId: "content-search-missing-truncated",
        },
      }).success,
    ).toBe(false);
  });
});
