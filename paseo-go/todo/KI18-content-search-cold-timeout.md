# KI-18 首次内容搜索冷路径超客户端等待窗→空态（终验轮实锤 2026-09-30）

## 现象（evidence/E_KI6 + daemon ws_slow_request）

成品 v0.3.0 真机：会话内**首次**内容搜索（Tier-2）冷路径 **5014ms**，超客户端 ~5s 等待窗 →
UI 显示空态；warm 重试 16 命中正常。非兜底 banner、非功能坏，但用户首搜=空态=坏体验。

## 根因方向（立案时判断，排查起点）

daemon 侧 content_search 预算本身 5s（KI-6S 口径）+ 冷路径开销（首扫 gitignore 遍历/IO 冷缓存）
→ 合法耗时可 >5s；客户端等待窗 ~5s 与 daemon 预算**同值竞态**，客户端先放弃。
排查：`src/shell/search/workspace-search.ts` 超时/等待窗常量 vs server `content-search.ts` 预算。

## 口径

1. 客户端等待窗 ≥ daemon 预算 + 裕量（如 8-10s），或搜索中态（spinner/骨架行）替代静默空态；
2. 超时后 UI 文案=「搜索超时，点击重试」而非空态（与能力闸静默降级区分开）；
3. 单测钉：超时分支产生 timeout 态非空结果态；重试路径复用 seq 守卫。
4. 真机帧：冷路径大仓首搜=搜索中→出结果（平板已就绪，100% 电）。

## 验收

typecheck/oxlint 零错；定向绿；app 全量=W1 零新增（并行纪律同前）；真机冷搜帧；
恰一次 commit `fix(paseo-go): KI-18 ...`（显式 pathspec）；报告 JSON。
