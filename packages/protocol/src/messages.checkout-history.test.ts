// Paseo Go KI-7 (pure-add): checkout.history.list request/response round-trips,
// page-window bounds, and DAG geometry fields (lane / topology / edges).
import { describe, expect, test } from "vitest";

import {
  CheckoutHistoryEntrySchema,
  CheckoutHistoryListRequestSchema,
  CheckoutHistoryListResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const mergeEntry = {
  sha: "2186ecb0000000000000000000000000000000000",
  shortSha: "2186ecb",
  subject: "Merge branch 'feature/save'",
  authorName: "karl",
  dateISO: "2026-09-28T21:10:00+08:00",
  refs: [
    { name: "main", kind: "head" },
    { name: "main", kind: "local" },
    { name: "origin/main", kind: "remote" },
  ],
  lane: 0,
  topology: "merge",
  edges: [{ fromLane: 0, toLane: 1, kind: "fork" }],
  laneEnds: false,
} as const;

const fullPayload = {
  cwd: "F:/Gd/IdleGame",
  isGit: true,
  entries: [mergeEntry],
  hasMore: true,
  currentBranch: "main",
  upstreamRef: "refs/remotes/origin/main",
  aheadOfOrigin: 2,
  behindOfOrigin: 1,
  hasRemote: true,
  error: null,
  requestId: "request-history",
};

describe("checkout.history.list schemas", () => {
  test("parses a minimal request and keeps paging fields absent", () => {
    expect(
      CheckoutHistoryListRequestSchema.parse({
        type: "checkout.history.list.request",
        cwd: "F:/Gd/IdleGame",
        requestId: "request-history",
      }),
    ).toEqual({
      type: "checkout.history.list.request",
      cwd: "F:/Gd/IdleGame",
      requestId: "request-history",
    });
  });

  test("parses a paged request", () => {
    expect(
      CheckoutHistoryListRequestSchema.parse({
        type: "checkout.history.list.request",
        cwd: "/tmp/repo",
        limit: 200,
        skip: 450,
        requestId: "request-history",
      }),
    ).toMatchObject({ limit: 200, skip: 450 });
  });

  test("rejects out-of-window limit and negative skip", () => {
    expect(() =>
      CheckoutHistoryListRequestSchema.parse({
        type: "checkout.history.list.request",
        cwd: "/tmp/repo",
        limit: 201,
        requestId: "r",
      }),
    ).toThrow();
    expect(() =>
      CheckoutHistoryListRequestSchema.parse({
        type: "checkout.history.list.request",
        cwd: "/tmp/repo",
        skip: -1,
        requestId: "r",
      }),
    ).toThrow();
  });

  test("parses a full response with DAG geometry", () => {
    const parsed = CheckoutHistoryListResponseSchema.parse({
      type: "checkout.history.list.response",
      payload: fullPayload,
    });
    expect(parsed.payload).toEqual(fullPayload);
    expect(parsed.payload.entries[0]?.topology).toBe("merge");
    expect(parsed.payload.entries[0]?.edges[0]?.kind).toBe("fork");
  });

  test("parses a non-git response", () => {
    expect(
      CheckoutHistoryListResponseSchema.parse({
        type: "checkout.history.list.response",
        payload: {
          cwd: "/tmp/nowhere",
          isGit: false,
          entries: [],
          hasMore: false,
          currentBranch: null,
          upstreamRef: null,
          aheadOfOrigin: null,
          behindOfOrigin: null,
          hasRemote: false,
          error: null,
          requestId: "request-history",
        },
      }).payload.isGit,
    ).toBe(false);
  });

  test("an entry without geometry defaults nothing — all DAG fields required", () => {
    expect(() =>
      CheckoutHistoryEntrySchema.parse({
        sha: "a".repeat(40),
        shortSha: "aaaaaaa",
        subject: "x",
        authorName: "y",
        dateISO: "2026-09-29T00:00:00+08:00",
        refs: [],
      }),
    ).toThrow();
  });

  test("parses the request through the inbound message union", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "checkout.history.list.request",
        cwd: "/tmp/repo",
        requestId: "request-history",
      }),
    ).toMatchObject({ type: "checkout.history.list.request" });
  });

  test("parses the response through the outbound message union", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "checkout.history.list.response",
        payload: fullPayload,
      }),
    ).toMatchObject({ type: "checkout.history.list.response" });
  });
});
