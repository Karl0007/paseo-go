# KI-17 KI-14 后果收尾三件（编排者拍板 2026-09-30，方向不变只收尾）

## 背景

KI-14（6ffe067a，壳态隐藏官方会话 chrome）落地后 agent 如实申报三条本卡后果。
编排者裁定：全部属于"隐藏官方顶栏"这一已批功能的必要收尾，不改变用户拍板方向。

## 三件口径

1. **会话内容顶 inset（P1，必修）**：官方带卸载后 `agent-chat-scroll` 从 y=0 起，
   浮层胶囊（compact 纯内容高 ~76dp 不透明）遮住首条消息（帧 evidence/KI14/03 实锤：
   首条 user-message top=80px < 胶囊底 190px）。
   修=壳态会话内容容器加 paddingTop=胶囊内容高（token 化，来自 compact-rows 同源常量，
   勿硬编码 190px；wide 用 wide 内容高）。承接点自己找（壳侧能改的容器/官方滚动容器的
   contentContainerStyle 若必须动官方文件 → 停下来 hub Main，不许私自扩触点）。
2. **宽屏门扩面（必修）**：触点门 `shellActive && isMobile` → **`shellActive`**
   （宽屏壳也藏官方 wide header 36dp + desktop fallback tab 行；否则胶囊回归纯内容高后
   宽屏露官方残条且"关 tab→归档"在宽屏复活=R2-08③ 回归面重开）。
   宽屏胶囊（wide inner 34dp）保持浮层；三处门（:1316 gate 态/:3857 header/:4074 tab 行）
   同步改；`useOfficialSessionChromeGates` 内 isMobile 读取若因此无用则删。
3. **无头屏（P3）**：冷深链 `paseogo://h/…` 直达会话（无 (shell) 在栈下）=官方带已藏
   但胶囊 visibility 契约不渲染 → 无头。修=放宽 `session-header/visibility.ts`：
   壳态会话屏**无条件**渲染胶囊（provenance 不再作可见性条件）；返回键兑底
   `router.replace(SHELL.chats)`（detail-back 已有同款姿势）。

## 验收

1. typecheck/oxlint 零错；visibility/compact-rows/session-header 域定向全绿
   （visibility 契约改动同步改测试钉）。
2. 真机（现车道 sh.paseo.debug 可验 JS）：①壳态会话滚到顶，首条消息完整可读可点
   （dump bounds：首条 top ≥ 胶囊底）；②`wm density 300` 宽屏态：官方 wide 带+fallback
   tab 行消失、胶囊浮层在位、无残条；恢复 density 250；③冷深链直达会话=胶囊在位
   可返回。帧存 paseo-go/evidence/KI17/（注意路径在 paseo-go/ 下）。
3. 恰一次 commit `fix(paseo-go): KI-17 ...`（显式 pathspec，零中途 add）。
4. 报告 JSON：{commit, gates, inset_source, wide_gate, headless_fix, frames, known_issues}。

## 环境

设备无线 `192.168.31.14:5555`；metro/devd 勿动；长按禁试；uiautomator swipe 触发+--window 姿势。
typecheck 前 rm router.d.ts；禁全量 app 套件（归 Main 终态门禁）与 server 全量。
