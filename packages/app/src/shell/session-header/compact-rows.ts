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
// 高度口径（方案②）：inner 真收 compact 56→44 / wide 36→34，与官方 header
// 定高的差额移进 sessionHeaderCoverCompensationDp——bar 底边仍钉在官方 tab 行
// 底沿，不透明 span 继续把官方 header+tab 行整个漆掉（R2-08③；FixB4 设备实锤
// 的 4px 窄条教训）。可见带高由官方在流布局（header [0, inset+64] + tab 行在
// 其下）钉死，带本身变矮需要上游触点，不在本卡范围（Main 另立卡请示用户）。
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";

/** The bar's iconButton size — the inner box' height floor (命中区不动). */
export const SESSION_HEADER_CONTROL_HEIGHT_DP = 34;

/** Two-line inner box heights: compact 56→44, wide 36→34 (wide 钳在控件高). */
export const SESSION_HEADER_INNER_HEIGHT_DP = { compact: 44, wide: 34 } as const;

export function sessionHeaderInnerHeightDp(isCompact: boolean): number {
  return isCompact ? SESSION_HEADER_INNER_HEIGHT_DP.compact : SESSION_HEADER_INNER_HEIGHT_DP.wide;
}

/**
 * The dp the bar's cover padding adds back so the bar's bottom edge does NOT
 * rise with the inner shrink (R2-08③ bottom pin). Flipping this to 0 is the
 * one-line switch to the literal "total height -12dp" form — it lifts the bar
 * bottom above the official tab row and re-exposes the tappable 切换标签
 * sliver (关 tab→归档 reachable). Do not flip without a ruling.
 */
export function sessionHeaderCoverCompensationDp(isCompact: boolean): number {
  const officialInner = isCompact ? HEADER_INNER_HEIGHT_MOBILE : HEADER_INNER_HEIGHT;
  return Math.max(0, officialInner - sessionHeaderInnerHeightDp(isCompact));
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
