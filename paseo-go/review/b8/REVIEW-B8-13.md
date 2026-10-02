# REVIEW-B8-13 [P2] 导入行时间改微信式绝对时间（用户拍板 U7=B）

## 现象

并排看对话列「周一/昨天」vs 导入列「8h/1d」，同一右缘槽位两套话。

## 根因

`packages/app/src/shell/import/rows.ts` importRowTimeLabel→formatCompactTimeAgo（R2-14 相对制）；F23 只搬位置未统口径。用户裁定统一为微信式。

## 修复方向

导入行时间走 `shell/chats/use-wechat-time-label`（与会话行同函数同输出）；R2-14 的 null→import.metaTimeUnknown 占位保留；rows.test 相应改钉。

## 验收

「同一时间输入→两屏同一串」各钉一例（修复前必红）；真机帧并排对照。
