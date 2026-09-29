// KI-8 (用户拍板 2026-09-29，高度口径 Main 裁定 2026-09-30 = 方案②): the session
// header capsule's two-line content + inner-box metrics. Pure — pinned by
// compact-rows.test.ts; the component only wires data into these functions.
//
// 首行（主字重）: `<项目> · <分支>` — 项目 = 壳内既有 workspace label 链
// (projectCustomName → projectDisplayName，workspace-command-row/
// workspace-favorite-row 同源)；分支 = 既有 checkout_status 查询
// (useCheckoutStatusQuery，文件屏在用，零新 RPC、push-driven 缓存)。
// 非 git 仓 / 查询未回 / 空分支 = 首行只显项目名——不显占位符、不闪骨架：
// 栏高是定值指标，分支何时到达都不移动布局。
// 次行（小字 muted）: 会话真标题，单行截断。descriptor 未 hydration（无项目
// 名）时退化为单行=标题走主字重样式，同样零占位。
//
// 高度口径（KI-14，用户拍板 2026-09-29；KI-17② 扩面，编排者拍板 2026-09-30）：
// workspace-screen.tsx 的上游触点在 shellActive（不再 && compact）下把官方 header
// 带（compact 与 wide 两条带）、mobile tab 行与 desktop fallback tab 行整个卸载
// （COMPAT(shellHideOfficialSessionChrome)），胶囊不再兼任盖条——KI-8 的 cover
// 补偿（sessionHeaderCoverCompensationDp）与 R2-08③ 的 tab-row-cover 一并退役，
// 带高回归纯两行内容高（compact 44 / wide 34），会话内容随之整体上移；KI-17①
// 起会话内容容器的顶 inset 读本文件底部的带底算式（同一真相源）。

import { HEADER_TOP_PADDING_MOBILE } from "@/constants/layout";

/**
 * RN text line-height ceiling the two-line block pins itself to (Android
 * fontScale guard, Roboto ≈1.172 / SF ≈1.195). Co-located here after KI-14
 * retired tab-row-cover.ts (its last live consumer was this capsule's styles);
 * compact-rows.test.ts pins the base+sm block fits the tightest inner.
 */
export const TEXT_LINE_HEIGHT_CEILING = 1.2;

/** The bar's iconButton size — the inner box' height floor (命中区不动). */
export const SESSION_HEADER_CONTROL_HEIGHT_DP = 34;

/** Two-line inner box heights: compact 56→44, wide 36→34 (wide 钳在控件高). */
export const SESSION_HEADER_INNER_HEIGHT_DP = { compact: 44, wide: 34 } as const;

export function sessionHeaderInnerHeightDp(isCompact: boolean): number {
  return isCompact ? SESSION_HEADER_INNER_HEIGHT_DP.compact : SESSION_HEADER_INNER_HEIGHT_DP.wide;
}

/** 胶囊 status-bar 之下的顶垫高：compact=HEADER_TOP_PADDING_MOBILE，wide=0。
 *  barStyle 的 paddingTop 与带底算式共用件（勿在别处重抄三元）。 */
export function sessionHeaderTopPadDp(isCompact: boolean): number {
  return isCompact ? HEADER_TOP_PADDING_MOBILE : 0;
}

/**
 * 胶囊带底边（窗口顶 → 不透明条下缘）= insets.top + topPad + inner。
 * shell-session-header barStyle 的高度算式即此函数（单真相源）；KI-17① 会话
 * 内容容器的 paddingTop 读同一个函数——条与内容永远同底。负 inset 钳 0（防御）。
 */
export function sessionHeaderBandBottomDp(statusBarInsetDp: number, isCompact: boolean): number {
  return (
    Math.max(0, statusBarInsetDp) +
    sessionHeaderTopPadDp(isCompact) +
    sessionHeaderInnerHeightDp(isCompact)
  );
}

/**
 * KI-17①: the session content container's top-inset style. Shell chrome owns
 * the top band ⇒ paddingTop = band bottom (content starts under the capsule,
 * first message never covered); shell chrome off ⇒ undefined — the official
 * layout stays byte-identical (pinned by compact-rows.test.ts).
 */
export function shellSessionContentInsetStyle(
  shellChromeActive: boolean,
  statusBarInsetDp: number,
  isCompact: boolean,
): { paddingTop: number } | undefined {
  if (!shellChromeActive) return undefined;
  return { paddingTop: sessionHeaderBandBottomDp(statusBarInsetDp, isCompact) };
}

/** The checkout_status slice the branch slot reads (structural, push-driven cache). */
export interface SessionHeaderCheckoutStatus {
  isGit: boolean;
  currentBranch: string | null;
}

/** 非 git / 查询未回 / 空分支 → null（首行只显项目名）。git 分支原样（trim 后）。 */
export function resolveSessionHeaderBranch(
  status: SessionHeaderCheckoutStatus | null | undefined,
): string | null {
  if (!status?.isGit) return null;
  const branch = status.currentBranch?.trim();
  return branch ? branch : null;
}

/** 壳内既有 workspace label 链（workspace-command-row/workspace-favorite-row
 * 同源）：projectCustomName(trim) → projectDisplayName → ""。descriptor 未
 * hydration=空串 → resolveSessionHeaderRows 走单行退化态。 */
export function resolveSessionHeaderProjectLabel(
  descriptor: { projectCustomName?: string | null; projectDisplayName?: string } | null | undefined,
): string {
  return descriptor?.projectCustomName?.trim() || descriptor?.projectDisplayName || "";
}

export interface SessionHeaderRowsInput {
  /** The workspace label chain result; "" when unavailable. */
  projectLabel: string;
  branch: string | null;
  /** The live session title (alias → agent title → untitled label). */
  title: string;
}

export interface SessionHeaderRows {
  primary: string;
  /** null = 单行退化态（primary 即标题）。 */
  secondary: string | null;
}

export function resolveSessionHeaderRows(input: SessionHeaderRowsInput): SessionHeaderRows {
  const project = input.projectLabel.trim();
  if (!project) return { primary: input.title, secondary: null };
  return {
    primary: input.branch ? `${project} · ${input.branch}` : project,
    secondary: input.title,
  };
}
