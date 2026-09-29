// KI-12 三 tab 统一顶栏容器（用户裁定 2026-09-29：「顶部逻辑和高度都不统一，理论上
// 应该都是固定一致高度，不会随着上下滚动移动」）。对话/工作区/我的三个 tab 的顶栏
// 全部换成这里——一个组件 = 一份高度、一份 inset、一份 token。
//
// 高度口径（读码后定值，KI-12 报告在册）：
// - 定高 = bar(44) + gap(8) + accessory 带(36) + 底衬(8) = 96dp 内容高。取「现三屏
//   最高者取齐」一侧：现状工作区头（标题 + 44 搜索条 + 节奏）内容高 ≈100，压到 96；
//   三屏恒等——accessory 带为空也保留占位，底边线与列表起点三 tab 同 y。
// - 单行 52~56 方案否决（读码实据）：对话顶栏控件（标题 + 主机胶囊 + 进行中/已归档
//   segment + 搜索 + ＋）单行最小内容宽 ≈340dp，宽屏列表列 260/300dp 下会把 ＋ 挤出
//   列缘（C32 的胶囊收缩兜不住标题进栏后的缺口）→ 胶囊留 bar 右槽、segment 进
//   accessory 带。
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

/** bar 行高（标题 + 右槽；32dp 图标钮 + 呼吸）。 */
export const SHELL_TAB_HEADER_BAR_HEIGHT_DP = 44;
/** accessory 带高（对话筛选 segment 等次级控件；空也保留 → 三 tab 等高）。 */
export const SHELL_TAB_HEADER_ACCESSORY_HEIGHT_DP = 36;
/** bar ↔ accessory 带间距。 */
export const SHELL_TAB_HEADER_GAP_DP = 8;
/** 带 ↔ 底边线衬距。 */
export const SHELL_TAB_HEADER_BOTTOM_PADDING_DP = 8;

/**
 * 固定内容高（不含 status-bar inset）。与内容无关是契约本体：三 tab 渲染同一
 * 容器 ⇒ 等高 == 同一常量；样式带高与本函数共用上面的导出常量，改带必改测试。
 */
export function shellTabHeaderContentHeightDp(): number {
  return (
    SHELL_TAB_HEADER_BAR_HEIGHT_DP +
    SHELL_TAB_HEADER_GAP_DP +
    SHELL_TAB_HEADER_ACCESSORY_HEIGHT_DP +
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
  /** accessory 带内容（对话 进行中/已归档 segment）；不传则带高照样保留。
   *  react-perf(jsx-no-jsx-as-prop)：调用方以 useMemo 稳引用传入。 */
  accessory?: ReactNode;
  /** 右槽内容：本屏控件（主机胶囊/搜索/＋…），横向同 gap；无 `title` 时吃满
   *  整行 = 顶栏搜索态变形（C9 姿势），总高不变、列表不跳位。 */
  children?: ReactNode;
}

export function ShellTabHeader({ title, accessory, children }: ShellTabHeaderProps) {
  // inset 只加一次：三个 body 不再自叠 paddingTop。
  const insets = useSafeAreaInsets();
  const fullRow = title == null;
  return (
    <View testID="shell-tab-header" style={[styles.container, { paddingTop: insets.top }]}>
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
      <View style={styles.accessory}>{accessory}</View>
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
  // flexShrink 承接。
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
    // 标题恒完整（三 tab 标题都是 2~3 个 CJK 字）；溢出全走右槽收缩。
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
  },
  accessory: {
    height: SHELL_TAB_HEADER_ACCESSORY_HEIGHT_DP,
    marginTop: SHELL_TAB_HEADER_GAP_DP,
    flexDirection: "row",
    alignItems: "center",
  },
}));
