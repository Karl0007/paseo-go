# M2 fork CI 全平台出包流水线（战略卡，前置 M1）

## 背景/用户拍板（2026-09-29）

终态=「一个仓 → GitHub Actions 全平台出包 → 我们自己的 Releases 是唯一分发/更新源」。
上游 workflows/ 底子已在 fork 仓库里，本卡=审计+改造+跑通。

## 口径

1. **审计**：`workflows/` 逐个 release workflow 列 secrets/凭据依赖表，分三类：
   可用（无需 secrets）/ 可替代 / 拿不到（Apple 公证、@getpaseo npm scope、FCM/EAS）——
   拿不到的显式降级并在报告列明。
2. **CLI**：CI 出 **npm tarball** 挂 Releases（不发 npm registry）；安装=
   `npm i -g <releases-url>.tgz`；版本 `0.10.1-go.N`。
3. **APK**：Actions 上 JDK+SDK 构建 release APK（debug keystore 从 repo secret 注入，
   keystore 本体持久保管纪律写进 BUILD.md）；sha256 进 release 说明。
4. **desktop**：win nsis/zip 可裸签出包（上游本就不签）；mac 无凭据→本轮不出，记录。
5. **Linux**：deb/tar.gz 保活（用户另一台 Linux 机按 DEPLOY-NOTES 同规范消费）。
6. **触发**：tag `v0.10.1-go.N` 驱动；latest 指针文件齐全。

## 前置决策（已解决 2026-09-30）

- ~~fork 目前只在本地，需用户建仓~~ → **`github.com/Karl0007/paseo-go` 已存在**（public，
  gh 建仓+推送+无证据历史验证完毕）。CI 落点=该 public 仓：dev → `make-public-mirror.sh`
  重放 → push tag → Actions 出包。注意：public 仓放 keystore secret 需开
  Actions 权限收紧（仅 owner 推送可触发；不开 fork 工作流）。

## 验收

1. tag 推上去 → Actions 全绿 → Releases 出现 CLI tarball+APK(+win zip)；
2. 三产物各装/跑一次：tarball 装出可起 daemon（测试 home+第三端口）、
   APK 装机冷启、zip 解包能跑（如本机策略允许，跑完即卸，禁忌#1 不破）；
3. 流水线文档进 BUILD.md 新章（出包→换装→任务重启 全链）。

产物冒烟允许一次设备道。commit 按 workflow 文件域恰一次。
