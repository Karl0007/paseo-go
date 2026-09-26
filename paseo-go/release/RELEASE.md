# Paseo Go release 落档（C13）

> 构建流程与坑位见 `paseo-go/BUILD.md` §3.5（含坑⑤ scheme 漂移根因）。APK 本体不 commit，本机路径：
> `C:\work\paseo-go\packages\app\android\app\build\outputs\apk\release\app-release.apk`

## 正式 APK（prebuild --clean 完整链，交付版）

| 项            | 值                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 版本          | Paseo Go 0.1.0（`paseo-go/VERSION`），关于页实拍 `evidence/C13/33-about-card.png`                                                                                                                      |
| 上游注入      | `EXPO_PUBLIC_PASEO_GO_UPSTREAM=db4fd334`（关于页 "上游 paseo @ db4fd334" 实拍同上）                                                                                                                    |
| 包名 / scheme | `app.paseo.shell` / `paseogo`（`prebuild --clean` 自 `app.config.js` 再生，与官方 `paseo` 分叉，F8）                                                                                                   |
| 大小 / sha256 | 105,346,916 B / `42b55f09685a8ff3743c4cbba647f48dee4b3298cfb64cd8873a7514daafd248`                                                                                                                     |
| 生成链        | `prebuild --clean`(PASEO_GO=1) → `build-release-wsl.sh` PHASES=0-4（日志 `build-official.log`、`prebuild-clean.log`）                                                                                  |
| 装机复验      | 全新装机→冷启（无 metro 离线 bundle）→欢迎页→直接连接 6767→`1/1 主机在线`（`evidence/C13/40-official-connected.png`）；`paseogo://chats` 直达、`paseo://` 归属官方（query-activities 不含 release 包） |

## 增量验证版（手改 manifest scheme，仅行为验证，不作交付）

| 项            | 值                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 大小 / sha256 | 105,330,536 B / sha 未留档（产物已被正式构建覆盖；仅行为验证用，非交付物）                                                                          |
| 装机验证      | `paseogo://chats` 冷启动直达壳对话页（`evidence/C13/38-scheme-fix-deeplink.png`）；`cmd package query-activities paseo://` 不再含 `app.paseo.shell` |

## 装机冒烟总表

见 C13 报告（hub send Main）；证据目录 `paseo-go/evidence/C13/`（01-38）。
