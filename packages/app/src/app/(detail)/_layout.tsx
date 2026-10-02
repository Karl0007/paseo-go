// 详情栈 (card C6 ruling, completed by KI-9): every secondary screen — preview,
// files browse, 导入, 快捷指令表单, 重命名 — is a REAL root-Stack push, so
// hardware/gesture back pops it onto whatever screen opened it without any in-tab
// interception (contrast the retired hidden-tab form, C5 KI-2). Transitions are
// the root Stack's defaults: slide-in on push, slide-out on pop. headerShown:
// false — every detail screen draws its own shell header from theme tokens.
//
// B8-SWIPE (批次八 F27): 堆叠页全宽右滑返回. The overlay rides the group layout
// (a sibling of the Stack, NOT per-screen): a box-none full-screen layer whose Pan
// pops on a rightward horizontal drag anywhere on the screen — the C21 left-edge
// band stays only on the official session screen (upstream scroll bodies cannot
// declare their exemption from the shell layer). 搜索态/sheet 打开 are excluded
// declaratively via shell/gestures/stack-back-gate; a leftward drag FAILS —
// 堆叠页上左滑不切 tab（返回栈优先）.
import { View } from "react-native";
import { Stack } from "expo-router";
import { ShellStackBackOverlay } from "@/shell/gestures/shell-stack-back-overlay";

const DETAIL_STACK_OPTIONS = { headerShown: false } as const;
const LAYOUT_ROOT = { flex: 1 } as const;

export default function DetailLayout() {
  return (
    <View style={LAYOUT_ROOT}>
      <Stack screenOptions={DETAIL_STACK_OPTIONS} />
      <ShellStackBackOverlay />
    </View>
  );
}
