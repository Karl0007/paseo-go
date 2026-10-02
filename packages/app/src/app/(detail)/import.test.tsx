/**
 * @vitest-environment jsdom
 */
// B8-IMPORT F23 acceptance — 导入行的版式对齐壳会话行终态（B8-ROWPILL 后的
// chat-list-row），且徽标 已归档 > 已导入 时只出现一枚。B8 review 轮追加：
// 卡 01（说明行 M 与屏上折叠树同轴 + 搜索态命中口径 + 两行截断）、
// 卡 08（rowLabel 并入「可能活跃」chip，视觉序）、卡 12（options 断言顺序
// 无关）、卡 13（导入行时间与对话行同函数同输出）。断言读 react-native-web
// 落在 DOM 上的 inline style，也就是原生行实际按着的 flex 契约
// （纪律与 chat-list-row.test.tsx 同款：钉的是布局契约，不是像素截图）。
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";
import { identityColor } from "@/styles/identity-colors";
import { projectAvatarFor } from "@/shell/chats/project-avatar";
import { useWechatTimeLabel } from "@/shell/chats/use-wechat-time-label";
import enStrings from "@/shell/locales/en.json";
import zhStrings from "@/shell/locales/zh.json";
import type * as HostRuntimeModule from "@/runtime/host-runtime";
import type * as HostFeaturesModule from "@/runtime/host-features";
import type * as ProvidersSnapshotModule from "@/hooks/use-providers-snapshot";
import type * as HostProjectsModule from "@/projects/host-projects";
import type { ImportRow, ImportRowBadge } from "@/shell/import/rows";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";

// ── 固定钟（卡 13）────────────────────────────────────────────────────────
// 「昨天」是绝对串：不受设备 12/24 小时制影响，两屏可以钉同一串字面。
const NOW = new Date(2026, 9, 2, 15, 0, 0);
const YESTERDAY_NOON = new Date(2026, 9, 1, 12, 0, 0).getTime();

// ── 屏级数据（卡 01）──────────────────────────────────────────────────────
// 200 条目 = 27 父行 + 173 子行；默认全折叠 → 屏上 27 行。搜索态回 3 条命中。
const screenData = vi.hoisted(() => ({
  entries: [] as FetchRecentProviderSessionEntry[],
  hits: [] as FetchRecentProviderSessionEntry[],
}));

// 卡 01③：说明行 Text 的 numberOfLines=2 钉在 props 边界——RNW 把
// -webkit-line-clamp 编译成原子类，jsdom 的 cssstyle 会丢该属性，DOM 侧
// 不可稳定观测；Text 换成记录 props 的透传壳，其余 RN 导出保持真实。
const textPropsByTestId = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const TextSpy = (props: { testID?: string } & Record<string, unknown>) => {
    if (typeof props.testID === "string") textPropsByTestId.set(props.testID, props);
    return React.createElement(actual.Text, props);
  };
  return { ...actual, Text: TextSpy };
});

vi.mock("react-i18next", () => ({
  // Echo t：行里的措辞全是 key，按 key 钉与按字钉同样强。带插值参数的调用把参数
  // 一并回显——B8-COUNT 说明行钉的就是那两个数本身（断言侧 parse，键序无关）。
  // `i18n` 喂 useWechatTimeLabel 的语言档（卡 13：星期档按 APP 语言格式化）。
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key} ${JSON.stringify(options)}`,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
// 屏体（默认导出）在模块图上拉起的重依赖——行单元测试不挂整屏；屏级接线测试
// （卡 01）只 mock 数据钩子，渲染真实屏体本身。
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/shell/components/host-picker-sheet", () => ({ ShellHostPickerSheet: () => null }));
// 搜索 morph 的输入面：一个「提交固定 query」的按钮，让屏级测试能进搜索态。
vi.mock("@/shell/components/search/search-mode-bar", () => ({
  SearchModeBar: ({ onQueryChange }: { onQueryChange: (query: string) => void }) =>
    React.createElement("button", {
      type: "button",
      "data-testid": "fake-search-commit",
      onClick: () => onQueryChange("登录"),
    }),
}));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: () => undefined }),
}));
vi.mock("@/shell/search/use-shell-search-back-priority", () => ({
  useShellSearchBackPriority: () => undefined,
}));
vi.mock("@/shell/gestures/stack-back-gate", () => ({
  setStackBackBlocked: () => undefined,
}));
// 数据钩子面（屏级测试）：列表来自 screenData，query 非空即「服务端命中集」。
vi.mock("@/shell/import/use-import-list", () => ({
  useImportList: (_limit: number, _serverId: string | null, _client: unknown, query: string) => ({
    listState: {
      status: "ready",
      entries: query.length > 0 ? screenData.hits : screenData.entries,
      alreadyImportedCount: 0,
      claimedTotal: 6597,
      providerErrors: [],
      error: null,
    },
    load: () => Promise.resolve(),
  }),
}));
vi.mock("@/shell/import/use-import-agent-index", () => ({
  useImportAgentHandleIndex: () => new Map(),
}));
// Partial：只换渲染期会真发请求的钩子，模块图其余导出保持真实。
vi.mock("@/runtime/host-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof HostRuntimeModule>()),
  useHosts: () => [{ serverId: "host-1", label: "workbench" }],
  useHostRuntimeClient: () => ({}),
}));
vi.mock("@/runtime/host-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HostFeaturesModule>()),
  useHostFeature: () => true,
}));
vi.mock("@/hooks/use-providers-snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof ProvidersSnapshotModule>()),
  useProvidersSnapshot: () => ({ supportsSnapshot: true, entries: [] }),
}));
vi.mock("@/projects/host-projects", async (importOriginal) => ({
  ...(await importOriginal<typeof HostProjectsModule>()),
  useHostProjects: () => [],
}));

import ShellImportScreen, { ImportClaimSummary, ImportRowCell } from "./import";

const PROJECT = "paseo-go";
const NOOP = () => {};

function rowFixture(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    key: "omp:handle-1",
    providerId: "omp",
    providerLabel: "OMP",
    providerHandleId: "handle-1",
    cwd: "C:/work/paseo-go",
    // F23：标题=首次用户输入，preview=末条摘要（副标题段）。
    title: "帮我修一下登录",
    nameLabel: "ReworkR45",
    parentHandleId: null,
    preview: "已经修好了，测试全绿",
    folder: "paseo-go",
    projectName: PROJECT,
    // 卡 13：固定「昨天正午」——微信档的「昨天」串，绝对、跨设备稳定。
    lastActivityAt: YESTERDAY_NOON,
    parentLabel: null,
    parentIsRawId: false,
    looksActive: false,
    existing: null,
    ...overrides,
  };
}

function renderCell(
  overrides: {
    row?: Partial<ImportRow>;
    badge?: ImportRowBadge | null;
    index?: number;
    depth?: 0 | 1;
    childCount?: number;
    selected?: boolean;
    onToggle?: (key: string) => void;
    onOpenBadge?: (badge: ImportRowBadge) => void;
  } = {},
) {
  return render(
    <ImportRowCell
      row={rowFixture(overrides.row)}
      depth={overrides.depth ?? 0}
      index={overrides.index ?? 0}
      selected={overrides.selected ?? false}
      disabled={false}
      badge={overrides.badge ?? null}
      childCount={overrides.childCount ?? 0}
      rootKey="omp:handle-1"
      expanded={false}
      onToggle={overrides.onToggle ?? NOOP}
      onToggleExpand={NOOP}
      onOpenBadge={overrides.onOpenBadge ?? NOOP}
    />,
  );
}

/** #rrggbb → css rgb()，即 react-native-web 写进 DOM 的形态。 */
function cssRgb(hex: string): string {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return `rgb(${channels.join(", ")})`;
}

/**
 * 说明行回显串的读法（卡 12）：key 前缀单独钉，options parse 后 toEqual——
 * 调用点键序怎么排都不碎，数值错传仍必红。
 */
function readClaimSummary(): { key: string; options: Record<string, unknown> } {
  const text = screen.getByTestId("shell-import-claim-summary").textContent ?? "";
  const sep = text.indexOf(" ");
  expect(sep).toBeGreaterThan(0);
  return {
    key: text.slice(0, sep),
    options: JSON.parse(text.slice(sep + 1)) as Record<string, unknown>,
  };
}

/** 对话行的时间出口（useWechatTimeLabel）直连探针——卡 13 的「同一函数」基准。 */
function WechatTimeProbe({ at }: { at: Date }) {
  const label = useWechatTimeLabel(at);
  return <Text testID="wechat-time-probe">{label}</Text>;
}

// ── 屏级 fixture（卡 01）──────────────────────────────────────────────────
function entry(
  handle: string,
  overrides: Partial<FetchRecentProviderSessionEntry> = {},
): FetchRecentProviderSessionEntry {
  return {
    providerId: "omp",
    providerLabel: "OMP",
    providerHandleId: handle,
    cwd: "C:/work/repo",
    title: `会话 ${handle}`,
    firstPromptPreview: `首个输入 ${handle}`,
    lastPromptPreview: `末条 ${handle}`,
    lastActivityAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

/** 200 条目 = 27 父 + 173 子（11×7 + 16×6）；默认全折叠 → 屏上恰 27 行。 */
const TREE_ENTRIES: FetchRecentProviderSessionEntry[] = [];
for (let p = 0; p < 27; p += 1) {
  TREE_ENTRIES.push(entry(`p-${p}`));
  const children = p < 11 ? 7 : 6;
  for (let c = 0; c < children; c += 1) {
    TREE_ENTRIES.push(entry(`c-${p}-${c}`, { parentHandleId: `p-${p}` }));
  }
}
const HIT_ENTRIES = [entry("h-1"), entry("h-2"), entry("h-3")];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW.getTime(), toFake: ["Date", "setTimeout", "clearTimeout"] });
  screenData.entries = TREE_ENTRIES;
  textPropsByTestId.clear();
  screenData.hits = HIT_ENTRIES;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ImportRowCell project tile (F23 与会话行同款取字/配色)", () => {
  it("paints the project's own initial on the project's own identity slot", () => {
    renderCell();
    const avatar = screen.getByTestId("shell-import-avatar-0");
    const expected = projectAvatarFor(PROJECT);
    expect(avatar.textContent).toBe(expected.initial);
    expect(avatar.style.backgroundColor).toBe(cssRgb(identityColor(expected.colorName)));
  });

  it("keeps a tile for a row without project facts (空槽会把行压矮)", () => {
    renderCell({ row: { projectName: null } });
    expect(screen.getByTestId("shell-import-avatar-0").textContent).toBe("?");
  });
});

describe("ImportRowCell title line (F23 时间贴右缘)", () => {
  it("keeps the clock in the right-edge group under an 80-char title", () => {
    renderCell({ row: { title: "长".repeat(80), looksActive: true } });
    const title = screen.getByTestId("shell-import-row-0-title");
    const active = screen.getByTestId("shell-import-row-0-active");
    const time = screen.getByTestId("shell-import-row-0-time");
    const trailing = time.parentElement as HTMLElement;
    // 会话行同款绘制顺序：标题 →「可能活跃」紧随 → 状态徽标位 → 右缘组，
    // 且时间是右缘组的最后一个像素。
    expect(active.previousElementSibling).toBe(title);
    expect(trailing.previousElementSibling).toBe(active);
    expect(trailing.lastElementChild).toBe(time);
    // 右缘组吃剩余宽度并右对齐；只有标题可收缩——徽标与时间永不挤出。
    expect(trailing.style.flexGrow).toBe("1");
    expect(trailing.style.justifyContent).toBe("flex-end");
    expect(trailing.style.flexShrink).toBe("0");
    expect(title.style.flexShrink).toBe("1");
    expect(active.style.flexShrink).toBe("0");
    expect(time.style.flexShrink).toBe("0");
  });

  it("moves the clock out of the subtitle line into the trailing group", () => {
    renderCell();
    expect(screen.getByTestId("shell-import-row-0-time").textContent).toBe("chats.time.yesterday");
    expect(screen.getByTestId("shell-import-row-0-subtitle").textContent).not.toContain(
      "chats.time.yesterday",
    );
  });
});

// REVIEW-B8-13（用户拍板 U7=B）：导入行时间与对话行同函数同输出——同一个瞬间，
// 行右缘的串必须与 useWechatTimeLabel（对话行 ChatTimestamp 按着的那个出口）
// 逐字相等。修复前行走 formatCompactTimeAgo（「1d/3d」相对制），每档必红。
describe("ImportRowCell clock = 对话行同款微信时间 (REVIEW-B8-13)", () => {
  const TIERS: Array<[string, Date]> = [
    ["今天", new Date(2026, 9, 2, 9, 30)],
    ["昨天", new Date(2026, 9, 1, 12, 0)],
    ["星期档", new Date(2026, 8, 30, 12, 0)],
    ["今年 MM-DD", new Date(2026, 8, 15, 12, 0)],
    ["跨年 YYYY-MM-DD", new Date(2025, 5, 1, 12, 0)],
  ];
  it.each(TIERS)("同一瞬间两屏同一串（%s）", (_tier, at) => {
    renderCell({ row: { lastActivityAt: at.getTime() } });
    render(<WechatTimeProbe at={at} />);
    expect(screen.getByTestId("shell-import-row-0-time").textContent).toBe(
      screen.getByTestId("wechat-time-probe").textContent,
    );
  });

  it("keeps the R2-14 placeholder for a host date the shell cannot parse", () => {
    renderCell({ row: { lastActivityAt: null } });
    expect(screen.getByTestId("shell-import-row-0-time").textContent).toBe(
      "import.metaTimeUnknown",
    );
  });
});

describe("ImportRowCell subtitle (F23 项目 · 末条摘要)", () => {
  it("reads 项目 · 名字 · 末条摘要", () => {
    renderCell();
    expect(screen.getByTestId("shell-import-row-0-subtitle").textContent).toBe(
      "paseo-go · ReworkR45 · 已经修好了，测试全绿",
    );
  });

  it("never prints the same excerpt twice when the session has one prompt", () => {
    renderCell({ row: { preview: "帮我修一下登录", nameLabel: null } });
    expect(screen.getByTestId("shell-import-row-0-subtitle").textContent).toBe("paseo-go");
  });
});

describe("ImportRowCell badge (F23 已归档 > 已导入)", () => {
  it("renders only 已归档 when both facts hold", () => {
    // 行同时带着服务端「已导入」事实与壳侧归档事实时，rows.buildImportRowBadgeMap
    // 只会送来一枚 archived 徽标（合并口径钉在 rows.test.ts）；这里钉的是屏——
    // 标题行上只有「已归档」，没有第二枚「已导入」。
    renderCell({
      badge: { state: "archived", agentId: "agent-1" },
      row: { existing: { agentId: "agent-1", archived: false } },
    });
    expect(screen.getByTestId("shell-import-row-0-badge-archived").textContent).toBe(
      "import.badgeArchived",
    );
    expect(screen.queryByTestId("shell-import-row-0-badge-imported")).toBeNull();
  });

  it("says title, subtitle, clock and badge out loud (label replaces child text)", () => {
    renderCell({ badge: { state: "archived", agentId: "agent-1" }, selected: true });
    const row = screen.getByTestId("shell-import-row-0");
    expect(row.getAttribute("aria-label")).toBe(
      "帮我修一下登录 · paseo-go · ReworkR45 · 已经修好了，测试全绿 · chats.time.yesterday · import.badgeArchived",
    );
    expect(row.getAttribute("role")).toBe("button");
  });

  // REVIEW-B8-08：accessibilityLabel 替换全部子文本（R4-13），「可能活跃」chip
  // 渲染在 label 之内、串之外=读屏丢失。chip 文案并入 rowLabel，顺序=视觉序：
  // 标题 → 可能活跃 → 副标题 → 时间 → 徽标。修复前串里没有 chip，必红。
  it("speaks the 可能活跃 chip in visual order (REVIEW-B8-08)", () => {
    renderCell({ row: { looksActive: true }, badge: { state: "imported", agentId: "a-1" } });
    expect(screen.getByTestId("shell-import-row-0").getAttribute("aria-label")).toBe(
      "帮我修一下登录 · import.activeBadge · paseo-go · ReworkR45 · 已经修好了，测试全绿 · chats.time.yesterday · import.badgeImported",
    );
  });

  it("presses route by state: 徽标行跳该徽标，无徽标行仍是勾选", () => {
    const onOpenBadge = vi.fn();
    const onToggle = vi.fn();
    renderCell({ badge: { state: "archived", agentId: "agent-1" }, onOpenBadge, onToggle });
    fireEvent.click(screen.getByTestId("shell-import-row-0"));
    expect(onOpenBadge).toHaveBeenCalledWith({ state: "archived", agentId: "agent-1" });
    expect(onToggle).not.toHaveBeenCalled();

    const onOpenPlain = vi.fn();
    const onTogglePlain = vi.fn();
    renderCell({ index: 1, onOpenBadge: onOpenPlain, onToggle: onTogglePlain });
    const plain = screen.getByTestId("shell-import-row-1");
    expect(plain.getAttribute("role")).toBe("checkbox");
    fireEvent.click(plain);
    expect(onTogglePlain).toHaveBeenCalledWith("omp:handle-1");
    expect(onOpenPlain).not.toHaveBeenCalled();
  });
});

// B8-COUNT (F24): 说明行是「两个口径并排说一次」的唯一出口——有数才说，
// 旧 daemon（字段缺失=null）与零认领都必须整行沉默，不能出现「共  个会话」。
describe("ImportClaimSummary (B8-COUNT 顶部说明行)", () => {
  it("states the full claim count next to the window it was cut from", () => {
    render(<ImportClaimSummary claimedTotal={6597} shown={200} searching={false} />);
    // 卡 12：key 前缀 + parse 后的 options——调用点 options 键序调换不碎，
    // 数值错传仍必红。
    expect(readClaimSummary()).toEqual({
      key: "import.claimedSummary",
      options: { count: 6597, shown: 200 },
    });
  });

  // REVIEW-B8-01：搜索态 rows 被 query 过滤，「列表展示最近 M 条」的口径不再
  // 成立——换命中口径（zh「命中 {shown} 条」），M 仍是屏上行数。修复前恒走
  // claimedSummary（「最近」措辞），必红。
  it("switches to the 命中 wording while a search query is active", () => {
    render(<ImportClaimSummary claimedTotal={6597} shown={3} searching={true} />);
    expect(readClaimSummary()).toEqual({
      key: "import.claimedSummarySearch",
      options: { count: 6597, shown: 3 },
    });
  });

  it("keeps the search copy free of the 最近 wording in both bundles", () => {
    // echo-t 只回显 key——措辞本身钉在 bundle 上（卡 01 验收「命中」口径）。
    const zh = zhStrings.import.claimedSummarySearch_other;
    const en = enStrings.import.claimedSummarySearch_other;
    expect(zh).toContain("命中");
    expect(zh).not.toContain("最近");
    expect(en).toMatch(/matching/i);
    expect(en).not.toMatch(/most recent/i);
  });

  it("lets the copy wrap to two lines on narrow screens", () => {
    render(<ImportClaimSummary claimedTotal={6597} shown={200} searching={false} />);
    // props 边界钉 numberOfLines=2（en 长句窄屏两行截断；一行砍尾是卡 01 现象）。
    expect(textPropsByTestId.get("shell-import-claim-summary-text")?.numberOfLines).toBe(2);
  });

  it("stays silent for a pre-B8 daemon and for zero claims", () => {
    render(<ImportClaimSummary claimedTotal={null} shown={200} searching={false} />);
    expect(screen.queryByTestId("shell-import-claim-summary")).toBeNull();
    render(<ImportClaimSummary claimedTotal={0} shown={200} searching={true} />);
    expect(screen.queryByTestId("shell-import-claim-summary")).toBeNull();
  });
});

// REVIEW-B8-01（P1）：M 必须与「列表展示」同轴=屏上折叠树的行数。此前
// shown=rows.length（去重窗口条目数，窗满必 200），说明行说 200、屏上只有
// 27——F24 要消的歧义多出第三个数。这里渲染真实屏体（数据钩子 mock），钉的
// 就是那根接线。修复前必红 200。
describe("ShellImportScreen claim summary wiring (REVIEW-B8-01)", () => {
  it("counts the collapsed-tree rows on screen, not the 200-entry window", () => {
    render(<ShellImportScreen />);
    expect(readClaimSummary()).toEqual({
      key: "import.claimedSummary",
      options: { count: 6597, shown: 27 },
    });
  });

  it("speaks 命中 and the hit count while the search query is live", () => {
    render(<ShellImportScreen />);
    fireEvent.click(screen.getByTestId("shell-import-search"));
    fireEvent.click(screen.getByTestId("fake-search-commit"));
    act(() => {
      vi.advanceTimersByTime(300); // IMPORT_SEARCH_DEBOUNCE_MS
    });
    expect(readClaimSummary()).toEqual({
      key: "import.claimedSummarySearch",
      options: { count: 6597, shown: 3 },
    });
  });
});
