# REVIEW-B9-11 [P3] reload/resume 重建 ManagedAgent 丢弃 activeSubagents，persistSnapshot 顺带抹记录

## 现象/根因

buildManagedAgentForRegister(:3844-3883) 逐字段构造不含新键→reload 徽标瞬灭+registry 整行替换清计数，至重挂首扫才自愈（有界）；对照 ownership 重置有 R5 注释、此键无说明=遗漏非设计。

## 修复方向（编排者裁定=保留）

reloadAgentSessionInternal preserved 列表补 activeSubagents 透传（子代理不因 reload 停跑，徽标不该闪）。

## 验收

live agent 带 2→reload→新 ManagedAgent 与 registry 记录均=2（修复前 undefined 必红）。
