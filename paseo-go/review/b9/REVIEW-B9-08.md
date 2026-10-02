# REVIEW-B9-08 [P2] 注释漂移：「行末像素」两说互斥+「18dp 圆形几何」对词串不成立

## 现象/根因

chat-list-row.tsx:703/728 仍称未读标记是 last pixel，:149-151/585-592 称子任务标是 last pixel；文件头行构成清单缺第三成员；「same circular geometry」为假（实测 63dp 胶囊）。

## 修复方向

随 9-03 修复一并：注释只写可断言事实；last-pixel 归属统一；文件头补「| 子任务标」。纯注释+措辞，无行为。

## 验收

grep「last pixel」单一口径；无「circular/同一几何」描述词串徽标。
