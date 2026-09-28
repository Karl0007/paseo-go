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
