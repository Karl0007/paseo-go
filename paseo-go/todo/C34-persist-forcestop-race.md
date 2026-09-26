# C34 调查：zustand persist 写入 × force-stop 竞态（收藏/指令偶发丢失）

## 现象（用户可见后果）

C19 真机轮观察（known_issues#2 移交）：4:02 收藏的 AGENTS.md 与 4:06 创建的指令 C19-probe，在 `adb am force-stop` 重启后**丢失**；更早（4:0x 之前）的 CLAUDE.md 收藏仍在。若复现属实=用户日常杀 app 会丢收藏/快捷指令——P1 级数据丢失；也可能是观察窗口巧合（写入其实已落盘，丢失另有因）。P2 立案，复现后升级。

## 根因候选（逐一定性，禁猜测定案）

1. zustand persist 异步写 AsyncStorage 与 force-stop 竞态（写未 flush 进程死）。
2. metro 开发态 JS 线程被 metro 重启打断，persist 未执行（dev-only，release 无 metro）——**必须区分 dev/release 行为**，否则误判严重度。
3. AsyncStorage(64MB 配置插件) 写失败静默。
4. C19 观察误差（创建/收藏实际未成功——回看其截图 07/10 时刻状态）。

## 修复方向

复现→定位→按根因修（候选姿势：写后立即回读校验/关键动作后 `persist.flush?`——以 zustand 版本实际 API 为准；禁无证据加"防抖持久化"）。若定性为 dev-only，写 BUILD.md 纪律并降级 known_issue。

## 验收

1. 复现脚本/步骤（debug+metro 与 release 包各一轮：收藏→立即 force-stop→重启→断言；收藏→等 10s→force-stop→断言）。
2. 定性结论=四候选之一+证据链（AsyncStorage 落盘时间线 vs force-stop 时刻）。
3. 若修：favorites/commands/readState/pins/settings 全 store 一致处置+回归测试；真机两轮通过。
4. 恰好一次 commit（或纯调查卡=文档 commit）。

## 范围

- 动：`src/shell/stores/**`（如需）+ 新测试；`src/shell/**` 消费方仅接线级
- 不动：官方 AsyncStorage 封装/插件
