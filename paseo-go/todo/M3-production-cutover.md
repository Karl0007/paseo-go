# M3 生产 daemon 切换自建链（战略卡，前置 M2）

## 背景/用户拍板（2026-09-29）

生产现状：任务 `PaseoDaemon` 跑**官方** @getpaseo/cli 0.10.1（DEPLOY-NOTES.md 架构）。
终态：同一任务改跑**我们 Releases 的 CLI tarball**——壳 APK 的私有能力
（导入树/内容搜索/git 历史）在生产主机生效，APK+daemon 一条供应链。

## 口径（全程按 `~/.paseo/DEPLOY-NOTES.md` 禁忌执行，它是生产真相）

1. **演练**：自建 daemon 装到独立 home + **第三端口**（不碰 6767/6768），
   手机临时配对验证：omp provider、密码闸、会话驱动、壳 APK 连它看导入树。
2. **切换**：Stop-ScheduledTask → `npm i -g <fork releases tarball>` →
   Start-ScheduledTask → **DEPLOY-NOTES 自检四条全绿**；回滚=装回官方同法重启。
3. **文档同步（用户授权后）**：DEPLOY-NOTES.md 的 CLI 版本行、升级仪式
   （`npm update -g` → 改为「从 fork Releases 拉新 tarball 重装+重启任务」）、
   禁忌#1 复核（desktop 仍禁）。
4. 官方手机 app 兼容验证保留（协议纯增纪律的成果）：切自建后官方 app 仍能连。

## 验收

自检四条绿 + 手机红米实测驱动一个 omp 会话 + 壳 APK 在生产主机上导入树/搜索/历史
三项私有能力可视（读图存 evidence/M3/）+ DEPLOY-NOTES 更新 diff 经用户过目。

设备道一次。生产动作每一步先 DM Main 备案（编排者盯刀，出错即回滚）。
