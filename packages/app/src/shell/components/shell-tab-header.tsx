// KI-12 三 tab 统一顶栏容器（用户裁定 2026-09-29：「顶部逻辑和高度都不统一，理论上
// 应该都是固定一致高度，不会随着上下滚动移动」）。对话/工作区/我的三个 tab 的顶栏
// 全部换成这里——一个组件 = 一份高度、一份 inset、一份 token。
//
// 高度口径（B4-F1 裁定 1，2026-09-30 翻案 KI-12 的两带 96dp 方案）：
// - 单行定高 = 顶衬(8) + bar(44) + 底衬(8) = 60dp 内容高。accessory 带废除
//   （用户：「太高了，工作区空白一大块」）；对话的 进行中/已归档 segment 上移进
//   bar 行右槽，窄列溢出走三级降级（见 chats-header 的 tier 断点）。
// - KI-12 当年否决单行的理由（≈340dp 最小内容宽挤掉 ＋）由新机制承接：标题
//   flexShrink+截断、胶囊收缩到圆点、segment 全称→短称→纯图标三档。
// - 等高契约不变：三 tab 渲染同一容器 ⇒ 等高 == 同一常量，与内容无关；
//   顶栏高度是常量 = 列表容器不随头栏重挂（B4-REGRESS 勘误的 remount 纪律）。
// - inset 只加一次：status-bar inset 在容器内以 paddingTop 上（原三屏各自的
//   insets.top / insets.top+12 全部拆除）；宿主屏一律不再自加。
// - 固定不滚动：容器渲染在 ScrollView/FlatList 之外（各 body 结构 = header 与列表
//   兄弟），宽屏 TabletListColumn 复用同一 body，天然同构。
// - 同款 token：左右 padding spacing[4]、底边线 borderWidth[1]/border（C21 会话条
//   同款）、标题 2xl semibold foreground（原三屏标题一致）。
import { type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** bar 行高（标题 + 右槽控件；C12 的 44dp 触达带）。 */
export const SHELL_TAB_HEADER_BAR_HEIGHT_DP = 44;
/** 顶衬（status-bar inset 之下、bar 之上；B4-F1 单行的呼吸位）。 */
export const SHELL_TAB_HEADER_TOP_PADDING_DP = 8;
/** 底衬（bar ↔ 底边线）。 */
export const SHELL_TAB_HEADER_BOTTOM_PADDING_DP = 8;

/**
 * 固定内容高（不含 status-bar inset）。与内容无关是契约本体：三 tab 渲染同一
 * 容器 ⇒ 等高 == 同一常量；样式带高与本函数共用上面的导出常量，改带必改测试。
 */
export function shellTabHeaderContentHeightDp(): number {
  return (
    SHELL_TAB_HEADER_TOP_PADDING_DP +
    SHELL_TAB_HEADER_BAR_HEIGHT_DP +
    SHELL_TAB_HEADER_BOTTOM_PADDING_DP
  );
}

/** 总高 = inset + 内容高。inset 系数恒 1（只加一次的算术面）；负值钳 0（防御）。 */
export function shellTabHeaderTotalHeightDp(statusBarInsetDp: number): number {
  return Math.max(0, statusBarInsetDp) + shellTabHeaderContentHeightDp();
}

export interface ShellTabHeaderProps {
  /** 左侧标题（「我的」仅标题即此形态）。省略 = 槽位吃满整行（搜索态变形）。 */
  title?: string;
  /** 右槽内容：本屏控件（主机胶囊/筛选 segment/搜索/＋…），横向同 gap；无
   *  `title` 时吃满整行 = 顶栏搜索态变形（C9 姿势），总高不变、列表不跳位。 */
  children?: ReactNode;
}

export function ShellTabHeader({ title, children }: ShellTabHeaderProps) {
  // inset 只加一次：三个 body 不再自叠 paddingTop。顶衬是常量，inset 带随设备。
  const insets = useSafeAreaInsets();
  const fullRow = title == null;
  return (
    <View
      testID="shell-tab-header"
      style={[styles.container, { paddingTop: insets.top + SHELL_TAB_HEADER_TOP_PADDING_DP }]}
    >
      <View style={styles.bar}>
        {fullRow ? null : (
          <>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.spacer} />
          </>
        )}
        <View style={fullRow ? styles.slotFull : styles.slot}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: SHELL_TAB_HEADER_BOTTOM_PADDING_DP,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  bar: {
    height: SHELL_TAB_HEADER_BAR_HEIGHT_DP,
    flexDirection: "row",
    alignItems: "center",
  },
  // 右槽（有标题时）：窄列（260/300dp）溢出的第一责任人；内部胶囊自带
  // flexShrink 承接（segment 保最小可点宽，不缩）。
  slot: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  // 搜索态（无标题）：槽位吃满整行（SearchModeBar 的 field flex:1 靠它撑开）。
  slotFull: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    // B4-F1 裁定 1：窄列溢出链=标题截断 → 胶囊收缩 → segment 三档降级；
    // 标题排第二顺位（spacer 先吃 0，slot 基数大先缩到内容底线后才轮到标题）。
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
}));
