# W1 基线注记：app 套件 4 个 Windows 环境性失败（won't-fix，验收口径卡）

## 背景 / 用户拍板

C0 known_issue。本机 `npx vitest run --pool=threads --maxWorkers=2` 基线 = **5447/5451**，4 个失败均为 Windows 环境性：zh-CN locale x3（'星期一' vs /Monday/ 等）、autocrlf CRLF x1、forges 测试 import.meta.url Windows 路径 bug x1。上游 Linux CI 全绿。

## 设计裁定

- `packages/**` 冻结，不修上游测试
- 后续所有卡的"套件全绿"验收口径 = **失败集合 ⊆ 本基线 4 项**（新失败=卡不过；少失败=更好）
- 每次收卡用同参数跑：`--pool=threads --maxWorkers=2`（内存坑，见 BUILD.md §2）

## 验收

本卡无代码改动，仅作验收口径固化；总验收对照表引用本卡编号。

## 补记（C1，2026-09-25）

本机负载下失败集合会漂移（C1 轮=time x2+parse-changelog x2+forges+input-draft.live 超时，与 C0 轮集合不同）。**验收口径升级为 stash 基线对照法**：`git stash push -u` 后重跑，失败集合逐条相同 = 无新增失败；`*.live.*` beforeAll 超时视为环境性；跑完立即 `git stash pop`（编排者监督）。

## 补记（批次二收尾，2026-09-27）：server 套件基线项

`workspace-same-cwd-isolation.e2e.test.ts` ×2 失败（"Provider mock is not configured"）=**上游测试腐化，非 fork 回归**：失败用例由上游 `3288e1cf` 引入且未传 `isDev:true`，其后上游 #4314/#4332 把 `DEV_AGENT_PROVIDER_DEFINITIONS`（mock）注册收进 isDev 闸；fork 对全因果链文件（测试/`test-utils`/`provider-registry`/`provider-snapshot-manager`/`provider-manifest`/`create.ts`）零改动（`git diff --name-only db4fd334..HEAD` 核对在案）。记入基线失败集合；上游修复或 fork 侧禁改纪律保持。
