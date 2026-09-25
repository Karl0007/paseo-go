# C0 构建链跑通（Paseo Go 开发闭环建立）

## 背景 / 用户拍板

叠加式 fork 方案（见 `paseo-go/DESIGN.md` §2）。工作目录 `C:/work/paseo-go`，基线 db4fd334。本卡不写任何产品代码，只建立"改代码→装机→截图"的开发闭环，产出后续所有卡复用的 runbook。

## 设计裁定（照此执行，不得重开）

- Node 22 + pnpm 11（corepack），Windows 环境（win32，PowerShell/bash 混合，注意路径）
- Android 验证设备优先级：`adb devices` 有真机 > Android 模拟器（若已装）> 都没有则报告 known_issue 并给出用户侧最省事的接入方案（如手机装 Expo dev client via LAN）
- 构建入口以仓内脚本为准（`packages/app` 的 scripts、`paseo` CLI `app android`、eas.json profile），选一个**能在本机无人值守重复执行**的，写死进 runbook

## 范围

- 动：安装依赖、（如需）本地构建产物；新建 `paseo-go/BUILD.md`、`paseo-go/evidence/C0/`
- 不动：`packages/**` 任何源文件

## 工程约束

- 全程 `git status` 保持干净（node_modules 等被 gitignore）；不 commit 任何构建产物
- 若官方 dev 流程要求登录 EAS：找免登录路径（本地 gradle / expo run:android）；确实绕不开则记录为 known_issue

## 验收（四项证据契约）

1. `pnpm typecheck`、`pnpm lint` 零错误（exit code 为证）
2. `pnpm --filter @getpaseo/app test` 全绿（尾部原文）
3. 真实运行：官方 app 的 Android dev build 装到设备/模拟器，成功连上一个 Paseo daemon 并显示会话列表
4. 读图：`paseo-go/evidence/C0/` ≥2 张（app 首页、连接 daemon 后的会话列表），亲自 read 写结论

- 恰好一次 commit（BUILD.md + evidence）；BUILD.md 必须含：依赖安装、启动 dev、构建 APK、装机、截图采集 五步的可复制命令
