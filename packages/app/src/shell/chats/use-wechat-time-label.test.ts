// B4-ROW ruling 6 acceptance: the WeChat time tiers and their boundaries. The
// calendar-day split (not elapsed hours) is what the ruling fixes — 23:50 and 00:10
// are different days — so every case is built from local-time instants and checked
// against the tier it must land in.
import { describe, expect, it } from "vitest";
import { describeWechatTime } from "./use-wechat-time-label";

const LABELS = { yesterday: "昨天" };
const local = (y: number, m: number, d: number, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm);
const label = (date: Date, now: Date) => describeWechatTime(date, now, LABELS).label;

describe("describeWechatTime", () => {
  it("shows clock time for today, and wakes at the minute tier for it", () => {
    const today = local(2026, 10, 1, 10, 11);
    const described = describeWechatTime(today, local(2026, 10, 1, 23, 59), LABELS);
    // Locale-driven (12h/24h follows the OS), so the shape is the contract: a clock
    // reading, never a date.
    expect(described.label).toMatch(/^\d{1,2}:\d{2}(\s?[AP]M)?$/);
    expect(described.resolution).toBe("minute");
  });

  it("says 昨天 for the previous calendar day, even 15 minutes back", () => {
    expect(label(local(2026, 9, 30, 23, 50), local(2026, 10, 1, 0, 5))).toBe("昨天");
    expect(
      describeWechatTime(local(2026, 9, 30, 20, 0), local(2026, 10, 1, 12, 0), LABELS),
    ).toMatchObject({ resolution: "hour" });
  });

  it("uses the weekday for days 2-6 and drops to MM-DD on day 7", () => {
    const now = local(2026, 10, 1, 12, 0);
    for (const day of [29, 28, 27, 26, 25]) {
      expect(label(local(2026, 9, day), now)).toBe(
        local(2026, 9, day).toLocaleDateString(undefined, { weekday: "short" }),
      );
    }
    expect(label(local(2026, 9, 24), now)).toBe("09-24");
  });

  it("zero-pads MM-DD inside the current year", () => {
    expect(label(local(2026, 1, 5), local(2026, 10, 1))).toBe("01-05");
    expect(label(local(2026, 9, 5), local(2026, 10, 1))).toBe("09-05");
  });

  it("carries the year once the date crosses into another one", () => {
    expect(label(local(2025, 12, 20), local(2026, 1, 2))).toBe("2025-12-20");
    expect(label(local(2025, 9, 5), local(2026, 10, 1))).toBe("2025-09-05");
  });

  it("keeps the weekday tier across a year boundary — recency outranks the year", () => {
    // 2025-12-30 is three days before 2026-01-02: the card's tiers are ordered, and
    // 「周二」 is the truer answer than a date the user watched happen.
    const recent = local(2025, 12, 30, 12, 0);
    expect(label(recent, local(2026, 1, 2, 12, 0))).toBe(
      recent.toLocaleDateString(undefined, { weekday: "short" }),
    );
  });

  it("reads a future-dated row as today's clock rather than a date it has not reached", () => {
    // Host clock skew: `lastActivityAt` is the host's, the label is the device's.
    expect(label(local(2026, 10, 2, 8, 0), local(2026, 10, 1, 12, 0))).toMatch(
      /^\d{1,2}:\d{2}(\s?[AP]M)?$/,
    );
  });
});
