# C8 我的 tab + 官方设置复用 + 壳设置

## 背景 / 用户拍板

DESIGN.md §6。基线 = C7 HEAD。

## 设计裁定（照此执行，不得重开）

- 概览卡：`N 主机 · M 项目 · K 活跃 agent`（数据来自既有订阅，无新 RPC）
- 官方设置：push 官方 settings 路由（每 host 入口列在概览卡下方）
- 壳设置（本地）：壳模式开关（写 settings store，重启生效+提示）｜主题（跟随/亮/暗——若官方 AppearanceProvider 支持覆盖则接官方，否则仅壳内生效并写明）｜默认启动 tab｜清除本地数据（全 paseoGo.\* keys，二次确认）｜关于（壳版本+上游 commit hash+许可证链接）
- 列表式布局对齐官方设置页视觉

## 范围

- 动：`src/app/(shell)/me.tsx`、`src/shell/stores/settings.ts`、locales
- 不动：官方源文件

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. app 包测试全绿（清除数据范围单测：只删 paseoGo.\*）
3. 真实运行：概览数字与 daemon 实况一致；进官方设置返回正常；壳模式开关切换→重启→进入官方/壳 IA；主题切换壳内即时生效
4. 读图：≥3 张（我的页、壳设置、开关切换后官方 IA 首页）

- 恰好一次 commit
