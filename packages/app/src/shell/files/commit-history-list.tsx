// 文件屏 git 记录段 UI (card KI-7, 用户二轮拍板照片=Git Graph): a fixed-width
// react-native-svg lane column draws the DAG (dot per commit, colored lanes,
// fork/merge curves — geometry precomputed server-side, this file only renders
// it), and the row body carries subject + ref badges + `短sha · 作者 · 相对时间`
// meta. The sync header (`main ⇅ origin/main ↑2 ↓1`) reads the existing
// checkout_status query. FlatList virtualizes; reaching the end fetches the
// next page. Row press keeps the C27 depth (copy sha — the diff panel is a
// known_issue, the official rows were never wired either).
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Svg, { Circle, Line, Path, Polygon } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import type { Theme } from "@/styles/theme";
import {
  buildSyncHeader,
  computeRowLanes,
  formatSyncHeader,
  refBadgeLabel,
  type CommitHistory,
  type HistoryEntry,
  type RowLanes,
  type SyncStatusInput,
} from "@/shell/files/commit-history";

// 卡口径: 左侧固定宽 ~48dp 泳道列. Three columns fit (10 + 2×14 + padding);
// deeper graphs clamp into the last column — Git Graph scrolls horizontally,
// a mobile pane compresses instead (rare; recorded in the card report).
const LANE_COL_WIDTH = 48;
const LANE_PAD = 10;
const LANE_SPACING = 14;
const MAX_LANE_COLUMNS = 3;
const ROW_HEIGHT = 56;
const DOT_RADIUS = 4.5;
const MERGE_RADIUS = 5.5;
const LINE_WIDTH = 2;
/** At most this many badges inline before the rest collapse into `+N`. */
const MAX_VISIBLE_BADGES = 3;

/** Fallback for a row index raced off the end of the page (stable identity). */
const EMPTY_LANES: RowLanes = { above: [], below: [] };

const LANE_COLOR_KEYS = ["accent", "blue", "green", "amber", "purple", "orange"] as const;
type LaneColorKey = (typeof LANE_COLOR_KEYS)[number];
type LanePalette = Record<LaneColorKey, string> & { border: string };

// withUnistyles + uniProps (docs/unistyles.md §3): SVG stroke props are
// third-party props, so the theme reaches them through the wrapper, never
// through the banned useUnistyles hook.
const lanePaletteMapping = (theme: Theme): { palette: LanePalette } => ({
  palette: {
    accent: theme.colors.accent,
    blue: theme.colors.palette.blue[500],
    green: theme.colors.palette.green[500],
    amber: theme.colors.palette.amber[500],
    purple: theme.colors.palette.purple[500],
    orange: theme.colors.palette.orange[500],
    border: theme.colors.border,
  },
});

function laneX(lane: number): number {
  return LANE_PAD + Math.min(lane, MAX_LANE_COLUMNS - 1) * LANE_SPACING;
}

/** 圆点/菱形 + 直线/贝塞尔曲线 per row — pure renderer, no layout math. */
function LaneGraph({
  entry,
  lanes,
  palette,
}: {
  entry: HistoryEntry;
  lanes: RowLanes;
  palette: LanePalette;
}) {
  const midY = ROW_HEIGHT / 2;
  const dotX = laneX(entry.lane);
  const lineColor = palette.border;
  const colorForLane = (lane: number): string =>
    palette[LANE_COLOR_KEYS[lane % LANE_COLOR_KEYS.length] as LaneColorKey];
  const mergeFrom = new Set(
    entry.edges.filter((edge) => edge.kind === "merge").map((edge) => edge.fromLane),
  );
  const forkTo = new Set(
    entry.edges.filter((edge) => edge.kind === "fork").map((edge) => edge.toLane),
  );
  const parts: ReactNode[] = [];

  for (const lane of lanes.above) {
    const x = laneX(lane);
    if (lane === entry.lane) {
      parts.push(
        <Line
          key={`a${String(lane)}`}
          x1={x}
          y1={0}
          x2={x}
          y2={midY}
          stroke={lineColor}
          strokeWidth={LINE_WIDTH}
        />,
      );
    } else if (mergeFrom.has(lane)) {
      // Lane converging into this dot (branch point): leave vertical, land on
      // the dot from above.
      parts.push(
        <Path
          key={`m${String(lane)}`}
          d={`M ${x} 0 C ${x} ${midY * 0.6}, ${dotX} ${midY * 0.4}, ${dotX} ${midY}`}
          stroke={colorForLane(lane)}
          strokeWidth={LINE_WIDTH}
          fill="none"
        />,
      );
    } else {
      parts.push(
        <Line
          key={`a${String(lane)}`}
          x1={x}
          y1={0}
          x2={x}
          y2={ROW_HEIGHT}
          stroke={lineColor}
          strokeWidth={LINE_WIDTH}
        />,
      );
    }
  }
  for (const lane of lanes.below) {
    const x = laneX(lane);
    if (lane === entry.lane) {
      parts.push(
        <Line
          key={`b${String(lane)}`}
          x1={x}
          y1={midY}
          x2={x}
          y2={ROW_HEIGHT}
          stroke={lineColor}
          strokeWidth={LINE_WIDTH}
        />,
      );
    } else if (forkTo.has(lane)) {
      // Curve leaving the dot for another lane (merge's second parent).
      parts.push(
        <Path
          key={`f${String(lane)}`}
          d={`M ${dotX} ${midY} C ${dotX} ${midY + (ROW_HEIGHT - midY) * 0.4}, ${x} ${ROW_HEIGHT * 0.75}, ${x} ${ROW_HEIGHT}`}
          stroke={colorForLane(lane)}
          strokeWidth={LINE_WIDTH}
          fill="none"
        />,
      );
    } else {
      parts.push(
        <Line
          key={`b${String(lane)}`}
          x1={x}
          y1={0}
          x2={x}
          y2={ROW_HEIGHT}
          stroke={lineColor}
          strokeWidth={LINE_WIDTH}
        />,
      );
    }
  }
  parts.push(
    entry.topology === "merge" ? (
      <Polygon
        key="dot"
        points={`${dotX},${midY - MERGE_RADIUS} ${dotX + MERGE_RADIUS},${midY} ${dotX},${midY + MERGE_RADIUS} ${dotX - MERGE_RADIUS},${midY}`}
        fill={colorForLane(entry.lane)}
      />
    ) : (
      <Circle key="dot" cx={dotX} cy={midY} r={DOT_RADIUS} fill={colorForLane(entry.lane)} />
    ),
  );
  return (
    <Svg width={LANE_COL_WIDTH} height={ROW_HEIGHT}>
      {parts}
    </Svg>
  );
}

const ThemedLaneGraph = withUnistyles(LaneGraph);

const RefBadge = memo(function RefBadge({ label, kind }: { label: string; kind: string }) {
  return (
    <View
      style={[
        styles.badge,
        kind === "head" && styles.badgeHead,
        kind === "local" && styles.badgeLocal,
        (kind === "remote" || kind === "tag") && styles.badgeMuted,
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          kind === "head" && styles.badgeTextHead,
          kind === "local" && styles.badgeTextLocal,
          (kind === "remote" || kind === "tag") && styles.badgeTextMuted,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
});

const HistoryRow = memo(function HistoryRow({
  entry,
  lanes,
  onPress,
}: {
  entry: HistoryEntry;
  lanes: RowLanes;
  onPress: (sha: string) => void;
}) {
  const timeAgo = useCompactTimeAgo(new Date(entry.dateISO));
  const handlePress = useCallback(() => onPress(entry.sha), [entry.sha, onPress]);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.row, pressed && styles.rowPressed],
    [],
  );
  const badges = entry.refs.slice(0, MAX_VISIBLE_BADGES);
  const hiddenBadgeCount = entry.refs.length - badges.length;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.subject} ${entry.shortSha}`}
      testID={`shell-history-row:${entry.shortSha}`}
      style={rowStyle}
    >
      <ThemedLaneGraph entry={entry} lanes={lanes} uniProps={lanePaletteMapping} />
      <View style={styles.textBlock}>
        <View style={styles.titleLine}>
          {badges.map((ref, index) => (
            <RefBadge
              key={`${ref.kind}:${ref.name}:${String(index)}`}
              label={refBadgeLabel(ref)}
              kind={ref.kind}
            />
          ))}
          {hiddenBadgeCount > 0 ? (
            <View style={[styles.badge, styles.badgeMuted]}>
              <Text style={[styles.badgeText, styles.badgeTextMuted]}>
                +{String(hiddenBadgeCount)}
              </Text>
            </View>
          ) : null}
          <Text style={styles.subject} numberOfLines={1}>
            {entry.subject}
          </Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {`${entry.shortSha} · ${entry.authorName} · ${timeAgo}`}
        </Text>
      </View>
    </Pressable>
  );
});

export function CommitHistoryList({
  history,
  status,
  onCommitPress,
}: {
  history: CommitHistory;
  status: SyncStatusInput | null;
  onCommitPress: (sha: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);

  const rows = useMemo(() => computeRowLanes(history.entries), [history.entries]);
  const syncHeader = buildSyncHeader(status);

  const renderItem = useCallback(
    ({ index, item }: { index: number; item: HistoryEntry }) => (
      <HistoryRow entry={item} lanes={rows[index] ?? EMPTY_LANES} onPress={onCommitPress} />
    ),
    [onCommitPress, rows],
  );
  const keyExtractor = useCallback((item: HistoryEntry) => item.sha, []);

  const footer = useMemo(() => {
    if (history.loadingMore) {
      return (
        <View style={styles.footer}>
          <LoadingSpinner size="small" color={styles.meta.color} />
        </View>
      );
    }
    if (history.failed) {
      return (
        <View style={styles.footer}>
          <Text style={styles.meta}>{t("files.history.loadFailed")}</Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={history.retry}
            testID="shell-history-retry"
          >
            {t("files.history.retry")}
          </Button>
        </View>
      );
    }
    if (!history.hasMore && history.entries.length > 0) {
      return (
        <View style={styles.footer}>
          <Text style={styles.meta}>{t("files.history.allLoaded")}</Text>
        </View>
      );
    }
    return null;
  }, [history, t]);

  if (history.loading && history.entries.length === 0) {
    return (
      <View style={styles.center} testID="shell-history-loading">
        <LoadingSpinner size="small" color={styles.meta.color} />
      </View>
    );
  }
  if (history.entries.length === 0) {
    return (
      <View style={styles.center} testID="shell-history-empty">
        <Text style={styles.meta}>{t("files.history.empty")}</Text>
        {history.failed ? (
          <Button
            variant="secondary"
            size="sm"
            onPress={history.retry}
            testID="shell-history-retry"
          >
            {t("files.history.retry")}
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.list} testID="shell-files-git-pane">
      {syncHeader ? (
        <Text style={styles.syncHeader} numberOfLines={1} testID="shell-history-sync">
          {formatSyncHeader(syncHeader)}
        </Text>
      ) : null}
      <FlatList
        data={history.entries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onEndReached={history.loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={footer}
        initialNumToRender={12}
        maxToRenderPerBatch={20}
        windowSize={9}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  syncHeader: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: ROW_HEIGHT,
    paddingRight: theme.spacing[4],
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
  },
  subject: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  badge: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    maxWidth: 140,
  },
  badgeHead: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  badgeLocal: {
    borderColor: theme.colors.accent,
  },
  badgeMuted: {
    borderColor: theme.colors.border,
  },
  badgeText: {
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
  },
  badgeTextHead: {
    color: theme.colors.accentForeground,
  },
  badgeTextLocal: {
    color: theme.colors.accent,
  },
  badgeTextMuted: {
    color: theme.colors.foregroundMuted,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
  },
}));
