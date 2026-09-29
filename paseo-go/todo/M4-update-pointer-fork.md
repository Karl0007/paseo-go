# M4 客户端更新指向 fork Releases（战略卡尾，前置 M2，可后置）

## 背景/用户拍板（2026-09-29）

「未来的更新流程，以及其他客户端的更新流程，都按照我们自己的 fork 作为下载链接。」

## 切片

1. **desktop 更新源补丁**：`electron-builder.yml` publish/ feed 指 fork Releases
   （新上游触点，申报制）；仅服务"其他机器装 desktop"场景——本机永久禁忌#1 不变。
   附带评估：给 desktop 出「纯客户端模式」补丁（默认 keepRunningAfterQuit=true），
   一并进 UPSTREAM-ISSUES 建议。
2. **壳 APK 版本检查**：启动时对 fork Releases latest tag 探一次
   （`0.10.x-go.N` 比对，一次性提示条+下载链接）；设置页加「检查更新」手动入口。
   纯壳侧（fetch+store 标记），无上游触点。
3. **CLI 升级仪式**：文档卡（BUILD.md 新章引用 M2），无代码。

## 验收

desktop：CI 出的 zip 在测试机（如有）能收到更新提示（无第二台则代码审+单测代证并如实记）。
APK：设置 fake latest → 真机提示条帧 + 点击落下载页；正常态无误报（读图存 evidence/M4/）。

两切片可拆两 commit 两卡执行（执行时再分），文件域互不相交。
