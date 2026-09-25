// 详情栈 (card C6 ruling): previews are a REAL root-Stack push, so hardware/gesture
// back pops them onto the files tab without any in-tab interception (contrast the
// hidden-tab files screen, C5 KI-2). headerShown:false — every detail screen draws
// its own shell header from theme tokens.
import { Stack } from "expo-router";

const DETAIL_STACK_OPTIONS = { headerShown: false } as const;

export default function DetailLayout() {
  return <Stack screenOptions={DETAIL_STACK_OPTIONS} />;
}
