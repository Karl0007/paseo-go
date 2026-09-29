// 详情栈 (card C6 ruling, completed by KI-9): every secondary screen — preview,
// files browse, 导入, 快捷指令表单, 重命名 — is a REAL root-Stack push, so
// hardware/gesture back pops it onto whatever screen opened it without any in-tab
// interception (contrast the retired hidden-tab form, C5 KI-2). Transitions are
// the root Stack's defaults: slide-in on push, slide-out on pop. headerShown:
// false — every detail screen draws its own shell header from theme tokens.
import { Stack } from "expo-router";

const DETAIL_STACK_OPTIONS = { headerShown: false } as const;

export default function DetailLayout() {
  return <Stack screenOptions={DETAIL_STACK_OPTIONS} />;
}
