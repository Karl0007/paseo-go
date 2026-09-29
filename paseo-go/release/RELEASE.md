# Paseo Go v0.3.0 落档（批次三 KI 批，2026-09-30）

| 项            | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本          | Paseo Go 0.3.0（`paseo-go/VERSION`+`SHELL_VERSION` 6c831daa）                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 内容          | 批三 KI 批：KI-4 树形导入 / KI-5 主机 sheet / KI-6+6S 两层文件搜索 / KI-7 Git Graph DAG / KI-8 双行会话头 / KI-9 二级屏迁根栈动画 / KI-11 长按拖动置顶 / KI-12 三 tab 等高顶栏 / KI-13 切主机即清 / KI-14 隐藏官方会话顶栏（触点）/ KI-15 骨架卡死修复 / KI-16 长按 250ms / KI-17 KI-14 后果收尾                                                                                                                                                                                 |
| 上游注入      | `EXPO_PUBLIC_PASEO_GO_UPSTREAM=db4fd334`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 包名 / scheme | `app.paseo.shell` / `paseogo`（production `prebuild --clean` 已核 applicationId，坑⑥防复发）                                                                                                                                                                                                                                                                                                                                                                                     |
| 大小 / sha256 | 105,586,448 B / `704aa07cfa5ee29480e60051f699e30fa76e5eadf5966588bde432746aeb7a7c`                                                                                                                                                                                                                                                                                                                                                                                               |
| 生成链        | production prebuild → `build-release-wsl.sh` PHASES=0-4（原生 hermesc FreeVis 66.7GB，防呆三断言+mv 头校验通过）；arm64-v8a 单 ABI                                                                                                                                                                                                                                                                                                                                               |
| 门禁          | typecheck ✅ / oxlint 0e0w ✅ / build:server ✅ / protocol 723/723 ✅ / app 全量 6082/6093（失败 4=W1∪C1 基线零新增）✅                                                                                                                                                                                                                                                                                                                                                          |
| 装机冒烟      | **✅ 已验（2026-09-30 终验轮，成品包真机）**：冷启首帧 **2.2s**（v0.2.0 基线 11s）；端到端 A-K 十一项 **10 PASS/1 DEFERRED（长按注入 OS 级，与新包无关）/0 FAIL**——工作区列表即出（KI-15）、三 tab 等高+滚动静止（KI-12）、导航/两层搜索/DAG 泳道 660 提交到底（KI-9/6/7）、会话屏 190px vs 基线 315px 官方带消失+首条不被遮（KI-8/14/17）、宽屏无残条、**真横屏旋转首验过**（新原生壳）；全程 0 FATAL 0 ANR。帧 `evidence/{A_cold..K_e2e}/`。新立 KI-18（首搜冷路径 5s 窗竞态） |
| 签名          | 仍为 debug keystore（上架前必换，TODO 结转 v0.2.0）                                                                                                                                                                                                                                                                                                                                                                                                                              |

# Paseo Go release 落档（C13）

> 构建流程与坑位见 `paseo-go/BUILD.md` §3.5（含坑⑤ scheme 漂移根因）。APK 本体不 commit，本机路径：
> `C:\work\paseo-go\packages\app\android\app\build\outputs\apk\release\app-release.apk`

## 正式 APK（prebuild --clean 完整链，交付版）

| 项            | 值                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本          | Paseo Go 0.1.0（`paseo-go/VERSION`），关于页实拍 `evidence/C13/33-about-card.png`                                                                                                                                                                                               |
| 上游注入      | `EXPO_PUBLIC_PASEO_GO_UPSTREAM=db4fd334`（关于页 "上游 paseo @ db4fd334" 实拍同上）                                                                                                                                                                                             |
| 包名 / scheme | `app.paseo.shell` / `paseogo`（`prebuild --clean` 自 `app.config.js` 再生，与官方 `paseo` 分叉，F8）                                                                                                                                                                            |
| 大小 / sha256 | 105,348,232 B / `1d4d20df0f067dbcc4b6a4d1ab1fa630a73ab366688ccbe9732ec7209f11fd64`(C13-F1 重打;首版 105,346,916 B / `42b55f09…afd248` 已被覆盖)                                                                                                                                 |
| 生成链        | `prebuild --clean`(PASEO_GO=1) → `build-release-wsl.sh` PHASES=0-4(日志 `build-official.log`、`prebuild-clean.log`);C13-F1 增量重打 PHASES=1-4(日志 `build-c13f1-rebuild.log`,bundle 变更=搜索键契约单一化 `src/file-explorer/state-keys.ts`)                                   |
| 装机复验      | 全新装机→冷启(无 metro 离线 bundle)→欢迎页→直接连接 6767→`1/1 主机在线`(`evidence/C13/40-official-connected.png`);`paseogo://chats` 直达、`paseo://` 归属官方(query-activities 不含 release 包);C13-F1 重打后:工作区浏览→搜索 `build` 命中 BUILD.md→预览实拍(`evidence/C13F1/`) |

## 增量验证版（手改 manifest scheme，仅行为验证，不作交付）

| 项            | 值                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 大小 / sha256 | 105,330,536 B / sha 未留档（产物已被正式构建覆盖；仅行为验证用，非交付物）                                                                          |
| 装机验证      | `paseogo://chats` 冷启动直达壳对话页（`evidence/C13/38-scheme-fix-deeplink.png`）；`cmd package query-activities paseo://` 不再含 `app.paseo.shell` |

## 装机冒烟总表

见 C13 报告（hub send Main）；证据目录 `paseo-go/evidence/C13/`（01-38）。

---

# Paseo Go v0.2.0 落档（批次二，2026-09-28）

| 项            | 值                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本          | Paseo Go 0.2.0（`paseo-go/VERSION`+`SHELL_VERSION`），关于页实拍 `evidence/RELEASE-020/02-version.png`                                                                                                                                        |
| 上游注入      | `EXPO_PUBLIC_PASEO_GO_UPSTREAM=db4fd334`（关于页同帧）                                                                                                                                                                                        |
| 包名 / scheme | `app.paseo.shell` / `paseogo`（⚠ 首构建踩坑⑥：树被 debug prebuild 烙成 `.debug` 基 applicationId，production 重 prebuild 后修正——BUILD §3.5 坑⑥）                                                                                             |
| 大小 / sha256 | 105,465,012 B / `cb074aff785039f8450db36b2eb825f5bf486d92ee52a710e49820ed3e4b2aaa`                                                                                                                                                            |
| 生成链        | production `prebuild --clean` → `build-release-wsl.sh` PHASES=0-1 → 手动原生 hermesc（坑⑦：WSL 整备消失，FreeVis 20.4GB 可成）→ 防呆三断言+mv → PHASES=3-4；日志 `.dev/release-*.log`                                                         |
| 装机冒烟      | 离线 bundle 冷启 **11s**×16（vs debug+metro 53-65s）；三 tab+横屏分栏+占位符（00/01/03/04 帧）；深链 `paseogo://` 双包选择器=debug 共存预期（§14.13/F2 口径），选定后直落（05 帧）；C34 release 轮 8/8 落盘（`evidence/C34/matrix-release/`） |
| 签名          | **仍为 debug keystore**——上架前必换（TODO 结转：`android/keystore.properties`+签名块替换+重跑链）                                                                                                                                             |
