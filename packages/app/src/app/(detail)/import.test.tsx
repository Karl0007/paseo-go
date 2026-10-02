/**
 * @vitest-environment jsdom
 */
// B8-IMPORT F23 acceptance — 导入行的版式对齐壳会话行终态（B8-ROWPILL 后的
// chat-list-row），且徽标 已归档 > 已导入 时只出现一枚。断言读 react-native-web
// 落在 DOM 上的 inline style，也就是原生行实际按着的 flex 契约
// （纪律与 chat-list-row.test.tsx 同款：钉的是布局契约，不是像素截图）。
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityColor } from "@/styles/identity-colors";
import { projectAvatarFor } from "@/shell/chats/project-avatar";
import type { ImportRow, ImportRowBadge } from "@/shell/import/rows";

vi.mock("react-i18next", () => ({
  // Echo t：行里的措辞全是 key，按 key 钉与按字钉同样强。带插值参数的调用把参数
  // 一并回显——B8-COUNT 说明行钉的就是那两个数本身。
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key} ${JSON.stringify(options)}`,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
// 屏体（默认导出）在模块图上拉起的重依赖——本测试只挂行单元，不挂整屏。
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/shell/components/host-picker-sheet", () => ({ ShellHostPickerSheet: () => null }));
vi.mock("@/shell/components/search/search-mode-bar", () => ({ SearchModeBar: () => null }));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

import { ImportClaimSummary, ImportRowCell } from "./import";

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
    lastActivityAt: Date.now() - 5 * 60_000,
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

afterEach(cleanup);

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
    expect(screen.getByTestId("shell-import-row-0-time").textContent).toBe("5m");
    expect(screen.getByTestId("shell-import-row-0-subtitle").textContent).not.toContain("5m");
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
      "帮我修一下登录 · paseo-go · ReworkR45 · 已经修好了，测试全绿 · 5m · import.badgeArchived",
    );
    expect(row.getAttribute("role")).toBe("button");
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
    render(<ImportClaimSummary claimedTotal={6597} shown={200} />);
    expect(screen.getByTestId("shell-import-claim-summary").textContent).toBe(
      'import.claimedSummary {"count":6597,"shown":200}',
    );
  });

  it("stays silent for a pre-B8 daemon and for zero claims", () => {
    render(<ImportClaimSummary claimedTotal={null} shown={200} />);
    expect(screen.queryByTestId("shell-import-claim-summary")).toBeNull();
    render(<ImportClaimSummary claimedTotal={0} shown={200} />);
    expect(screen.queryByTestId("shell-import-claim-summary")).toBeNull();
  });
});
