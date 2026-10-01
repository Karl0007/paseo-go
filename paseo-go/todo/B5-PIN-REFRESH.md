# B5-PIN + B5-NOREFRESH 对话列表手势双修（F14 P1 + F15）

## B5-PIN 置顶往返消失（P1）

- 复现：非置顶项长按→拖到顶（置顶成功）→取消置顶 → **该项从列表消失**。
- 查 pinned store 与列表派生（置顶段+非置顶段合并）：疑重排状态机删而未插/key 错位。修到往返任意次不丢项，加回归测（任意 pin/unpin 序列后集合守恒）。
- 真机复现帧：消失前因后果 + 修复后往返帧。

## B5-NOREFRESH 长按拖动期间禁刷新

- 现象：长按后向下拖动触发下拉刷新。口径：长按拖动期间**任何情况不得**触发刷新。
- FixB 的 gestureLiveRef 吞回调有洞（R4-09 自留缺口坐实）；FixB 曾实测 scrollEnabled 被 RN SwipeRefreshLayout 忽略——若属实，改用可行动作（如长按激活瞬间切 enabled=false / 受控 refreshing / 手势门 onRefresh 全路径），以真机行为为准绳。
- 真机帧：长按+下拉+松手 → 无刷新发生（列表不 reload）；正常顶部下拉刷新仍可用。

## 验收

两卡各自恰好一次 commit（共两枚）；scoped shell 全量绿；证据契约四项。
