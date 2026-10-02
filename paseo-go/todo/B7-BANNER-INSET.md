# B7-BANNER 更新横幅让出系统状态栏（F20）

## 口径

- 「发现新版本」横幅现渲染在 y=0 压住系统状态栏（时间/图标重叠，用户截图实锤）。修=横幅顶部加 `useSafeAreaInsets().top`（壳正册姿势，files-screen-body/shell-session-header 同款），仍流内下推 tab 区。
- 横屏/刘海由 insets 天然覆盖；✕/点击行为不动。

## 验收

- 测：banner 组件测断言 paddingTop=insets.top（mock safe-area）。
- 真机帧：metro 热更+`EXPO_PUBLIC_PASEO_GO_UPDATE_FEED` 本地 mock（BUILD.md 测试钩）触发横幅，截图=横幅完整位于状态栏下方、状态栏图标无遮挡。
- 恰好一次 commit；scoped shell 测+typecheck+oxlint。
