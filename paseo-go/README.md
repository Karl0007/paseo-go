# Paseo Go — 接手入口（先读这页）

> 手机优先的 Paseo 壳 app。当前状态：**v0.1.0 验收通过**（分支 `paseo-go/v0.1.0`，33 commits on `db4fd334`=上游 fork 基点）。
> 发布物：`app-release.apk` sha256=`1d4d20df…fd64`（105MB，debug keystore；正式版上架前换签名，见 RELEASE.md TODO）。
> 唯一开放项：置顶拖拽真人手指复验一次（ACCEPTANCE §5 台账首行）。

## 阅读顺序（按意图选）

| 你想干什么                    | 读什么                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 了解产品/架构/什么不能动      | `DESIGN.md`（**冻结的唯一真相**；§2 铁律=改动前必读：缝隙恰好两个、新代码只进 `src/shell/**`+`src/app/(shell)/**`、路由串收敛 `routes.ts`、i18n/主题零缝隙） |
| 跑起来（构建/装机/调试/门禁） | `BUILD.md`（§0 本机环境事实+内存坑 → §1-4 闭环 runbook → §3.5 release 构建五坑+一键脚本 → 已知问题表）                                                       |
| 修 bug / 加功能               | 先 `ACCEPTANCE.md` §5 看是否已立案 → 领 known_issue 卡或按 `todo/` 卡式写新卡（口径+证据契约四项）→ 照 BUILD.md 闭环执行                                     |
| 查验收证据/历史决策           | `ACCEPTANCE.md`（总对照表）→ `todo/<卡号>-*.md`（**归档只读**：每卡=口径+裁定+勘误，勿改历史，新决策写新卡）→ `evidence/<卡号>/` 截图                        |
| 通知/推送相关                 | `NOTIFY.md`（含 EAS/FCM 不可达裁定）                                                                                                                         |
| 重打 release APK              | `BUILD.md` §3.5 + `paseo-go/release/build-release-wsl.sh`（PHASES=0-4 幂等；**构建窗口纪律**：hermesc 5-9 分钟需整机 FreeVis≥23GB，停 metro/daemon/vitest）  |

## 关键事实速查

- 上游同步：`git merge upstream/main`；缝隙两文件冲突时"重新贴缝"（DESIGN §2.7）；`src/shell/**` 与 `(shell)/**` 永不冲突
- ⚠ 上游触点=2 缝隙 + 1 组键契约微缝（`src/file-explorer/state-keys.ts`+`use-file-explorer-actions.ts`+`file-explorer-pane.tsx` 1 行，C13-F1 后补裁定，解法口径见 ACCEPTANCE §1a）+ 根 `CLAUDE.md` 一段 fork 指路（纯增，merge 时保留上游正文、重贴本段即可）；除这 6 文件外上游零改动
- 壳包名 `app.paseo.shell`（debug=`.debug` 后缀），scheme `paseogo://`（与官方 `paseo://` 已分叉）；与官方 app 可共存安装
- 本地态：zustand persist 前缀 `paseoGo.` 六 store；"我的→壳设置→清除本地数据"一键复位；不加密是裁定（DESIGN §6 威胁模型）
- 测试基线：app 套件失败集=W1 环境项（`todo/W1-suite-baseline.md`），改动验收=失败集合不变而非零失败
- 设备真值：华为 MatePad 坐标/adb 路径/IME 注入坑（**测输入框必用 ADBKeyboard**，百度输入法会吞改注入文本，BUILD.md §4）

## 环境恢复（omp/机器重启后）

hub 进程全部随会话死，重建命令在 `BUILD.md` §4/已知问题#6（devd=6767、daemon2=6768、metro 按需；构建与 daemon 严格分时）。
