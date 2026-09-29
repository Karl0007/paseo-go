# M1 merge upstream 0.10.1 进 fork（战略卡，排队尾）

## 背景/用户拍板（2026-09-29）

自建供应链第一步：fork 基点还停在 db4fd334（0.9.2 线），上游已 0.10.1。
生产切换（M3）前必须先合流，否则自建 CLI 把落后 daemon 推上生产。

## 口径

- `git merge upstream/main`（DESIGN §2.7 解缝纪律）；
- 解缝面 = 原 2 缝隙 + 键契约微缝 3 文件 + CLAUDE.md fork 段 + **批次三新增触点**
  （KI-6S：messages.ts/session.ts/operation-permissions.ts；KI-6/KI-7 落地后的全部申报点）；
- 上游 0.9.2→0.10.1 的 app/server/cli 变更全量进来，壳侧行为以卡库回归为准；
- 版本策略：merge 后 `paseo-go/VERSION` 起 `0.10.1-go.0` 系（M2 消费）。

## 验收（证据契约四项）

1. typecheck/lint/build:server/protocol 全绿；
2. app+server+protocol 套件失败集=基线零新增（**unit-only，禁全量 server 套件**——内存纪律）；
3. 真机：三 tab+会话+导入+文件屏 冒烟回归（车道 device-lane.md）；
4. 读图 ≥4 存 `evidence/M1/`。

merge commit + 解缝修正 commit 允许成对（merge 类工作豁免"恰一次"，报告列明）。
前置：无（但排在全部 KI 卡之后，用户 2026-09-29 拍板顺序）。
