// WeChat-style absolute timestamp for the 对话 row (B4-ROW, batch-4 F4 ruling 6):
// the time moves out of the subtitle onto the right of the title line, and stops
// being relative. 今天 `HH:MM` · 昨天 · 星期X · 今年 `MM-DD` · 跨年 `YYYY-MM-DD`.
//
// `useCompactTimeAgo` stays exactly where it is — the official sidebar, the desktop
// tab strip and the shell's commit list all read relative time and none of them asked
// to change. Only the chat row swaps.
//
// The clock posture is the existing one (see `hooks/use-compact-time-ago`): the label
// lives in the smallest component that renders it, the shared ticker wakes it at the
// rate the LABEL changes rather than per row, and state only sets when the string
// actually moved. A day-boundary label (「昨天」) is the one that would otherwise lie
// after midnight, so non-today rows subscribe at the hour tier (≤30 min late) instead
// of the day tier's 6 hours — the rollover is a calendar fact, not an elapsed count.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { subscribeToRelativeTimeTick, type TickResolution } from "@/utils/relative-time-ticker";
import type { RelativeTimeResolution } from "@/utils/time";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

export interface WechatTimeLabels {
  /** 「昨天」/ "Yesterday" — the only tier that needs a word. */
  yesterday: string;
}

export interface WechatTimeDescription {
  label: string;
  resolution: RelativeTimeResolution;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Local midnights between two instants (0 = same day, 1 = yesterday). Counted on the
 * calendar, not by elapsed time, and rounded so a 23/25-hour DST day still counts as
 * one. Mirrors the private helper in utils/time.ts — copied rather than reached into,
 * because that file is upstream and this card adds no touchpoint to it.
 */
function calendarDaysBetween(earlier: Date, later: Date): number {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDay(later) - startOfDay(earlier)) / (24 * HOUR_MS));
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

// Carries `hourCycle` from the resolved options so the label follows the OS 12h/24h
// switch instead of the locale default — the same reason utils/time.ts caches one
// formatter this way. Rebuilt only when the locale resolves differently.
let cachedClock: Intl.DateTimeFormat | null = null;
function clockFormatter(): Intl.DateTimeFormat {
  if (cachedClock) return cachedClock;
  const resolved = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).resolvedOptions();
  cachedClock = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: resolved.hourCycle,
  });
  return cachedClock;
}

/**
 * Pure half of the hook — `now` and `labels` are injected so the tiers are testable
 * against fixed instants. A future-dated row (host clock skew) reads as today's clock
 * time rather than falling through to a date the chat has not reached.
 */
export function describeWechatTime(
  date: Date,
  now: Date,
  labels: WechatTimeLabels,
): WechatTimeDescription {
  const days = calendarDaysBetween(date, now);
  if (days <= 0) return { label: clockFormatter().format(date), resolution: "minute" };

  if (days === 1) return { label: labels.yesterday, resolution: "hour" };
  if (days < 7) {
    // Locale-driven: 「周一」 on a zh device, "Mon" on an en one.
    return { label: date.toLocaleDateString(undefined, { weekday: "short" }), resolution: "hour" };
  }
  // Pinned numeric formats, not Intl date parts — the card fixes `MM-DD` /
  // `YYYY-MM-DD` and a locale-dependent separator would make the column jitter.
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return {
    label:
      date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}-${monthDay}`,
    resolution: "hour",
  };
}

/**
 * The live label for one instant. Call it from the smallest component that renders the
 * text so a tick re-renders one `<Text>` and never the row or the list.
 * null/undefined date → empty string (the caller renders nothing).
 */
export function useWechatTimeLabel(date: Date | null | undefined): string {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const yesterday = t("chats.time.yesterday");
  // Keyed on the instant, not the Date object — the store parses a fresh Date per
  // payload, and identity churn would rebuild the subscription for an unchanged time.
  // R2-14: protocol dates are bare strings, so an Invalid Date reads as absent here
  // rather than emitting a 「NaN-NaN」 column (first frame included).
  const ms = date ? date.getTime() : null;
  const time = ms !== null && Number.isFinite(ms) ? ms : null;
  const [label, setLabel] = useState(() =>
    time === null ? "" : describeWechatTime(new Date(time), new Date(), { yesterday }).label,
  );

  useEffect(() => {
    if (time === null) {
      setLabel("");
      return undefined;
    }
    const source = new Date(time);
    const labels = { yesterday };
    let current = describeWechatTime(source, new Date(), labels);
    setLabel(current.label);

    let unsubscribe: (() => void) | null = null;
    const attach = () => {
      if (current.resolution === "static") return;
      unsubscribe = subscribeToRelativeTimeTick(current.resolution as TickResolution, handleTick);
    };
    const handleTick = () => {
      const next = describeWechatTime(source, new Date(), labels);
      if (next.label !== current.label) setLabel(next.label);
      if (next.resolution !== current.resolution) {
        // Aged into a slower tier — or out of them entirely.
        current = next;
        unsubscribe?.();
        unsubscribe = null;
        attach();
        return;
      }
      current = next;
    };
    attach();
    return () => unsubscribe?.();
  }, [time, yesterday]);

  return label;
}
