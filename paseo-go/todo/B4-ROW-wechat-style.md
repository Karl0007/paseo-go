# B4-ROW: 对话行微信化（F4 全案）

来源：BATCH4-ALIGNMENT.md F4（裁定 4 组 8 条+Q3=b）。依赖：B4-PREVIEW 字段已落。

## 口径

1. 排序：derive.ts 废 needs_attention 跳队段（红字并入行）；置顶/离线组不动；recent 纯时间倒序维持。
2. 行布局：头像=项目 hash 色圆角方块+首字符（确定性纯函数+单测）；标题=`项目-worktree[-备注]`；时间=标题行右侧+微信式绝对格式（新 hook，今天 HH:MM/昨天/星期X/MM-DD）；转圈=running 态 ActivityIndicator 时间左侧。
3. 副标题优先级：`[草稿]`(红前缀，读 draft-store 只读) > `[需要回复]`(红)+预览 > `我: `前缀预览/预览（消费 B4-PREVIEW 字段）。
4. locales zh/en；旧 activity 词表废弃项清理。

## 验收

门禁+scoped 绿+derive/新 hook 单测；真机帧：新行五要素齐（icon/标题式/时间位/预览/转圈）+草稿态+需要回复态各一；排序=纯时间序帧。
