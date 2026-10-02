# Review 台账 — Paseo Go 批次八增量 基线 fd3452f75 范围 6 码提交(1afc4a215..fd3452f75)

| #   | 级别 | 复核                | 状态      | 修复批次 | 标题                           | 销卡证据 |
| --- | ---- | ------------------- | --------- | -------- | ------------------------------ | -------- | ---------------- |
| 01  | P1   | 编排者直证          | confirmed | fixing   | 说明行 M 不同轴(合并 C3/H2/U5) |          | 1bc1fa1c8 待复审 |
| 02  | P1   | 编排者直证          | confirmed | fixing   | workspace/me 未挂 surfaceStyle |          | 87186796c 待复审 |
| 03  | P2   | CONFIRMED           | confirmed | fixing   | land 140ms 窗导航劫持          |          | 87186796c        |
| 04  | P2   | CONFIRMED(探针红)   | confirmed | fixing   | resolveImportTarget 漏折叠     |          | 0a01c0a59        |
| 05  | P3   | DOWNGRADE→P3(DRY)   | confirmed | fixing   | AVATAR_FILL 双份真相           |          | 1bc1fa1c8        |
| 06  | P3   | DOWNGRADE→P3(防御)  | confirmed | fixing   | 第三套路径折叠发散             |          | 0a01c0a59        |
| 07  | P2   | CONFIRMED           | confirmed | fixing   | F22 tint 纸面护栏              |          | 0a01c0a59        |
| 08  | P2   | CONFIRMED           | confirmed | fixing   | a11y 漏可能活跃                |          | 1bc1fa1c8        |
| 09  | P2   | 编排者直证(md5)     | confirmed | fixing   | SWIPE 返回帧证伪(证据债)       |          | 87186796c 待复审 |
| 10  | P2   | CONFIRMED(重算复现) | confirmed | fixing   | 未知 pill 浅色 AA(裁定A)       |          | 0a01c0a59        |
| 11  | P3   | CONFIRMED           | confirmed | fixing   | serializeAgentAxes 注释矛盾    |          | 0a01c0a59        |
| 12  | P3   | CONFIRMED           | confirmed | fixing   | i18n JSON 键序断言             |          | 1bc1fa1c8        |
| 13  | P2   | 用户拍板            | confirmed | fixing   | 导入行时间改微信式(U7-B)       |          | 1bc1fa1c8        |

状态机：open → confirmed → fixing → done（P0/P1 须复审三查）/ rejected / wontfix
拍板落定（用户 2026-10-02）：U6=A 保持沉默（结案）｜U7=**B 导入屏改微信式绝对时间**（→卡 13）｜T3=A 维持现状（结案，B4 先例）。修复批次 F1 导入屏域 / F2 手势域 / F3 杂域，帧道序 F2>F1>F3。
收口：待 P1 复审三查（01/02/09）。09 升级记录：复核重拍发现 F27 全宽返回在**所有堆叠屏从未生效**（Portal 兄弟层 RNGH 命中不到触点），非证据债而是 P1 功能缺陷；87186796c 重写为 (detail) 布局根挂 Pan，import/commands-edit 真机弹回帧（10/11、14/15）关闭旧 FAIL 12/13。F1 搜索态「命中 200」=命中达窗上限截顶，与屏上渲染同轴（KI 缓办：截顶未标「+」）。
