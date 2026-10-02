# REVIEW-B9-09 [P2] ghosttyDark 变体主题下 statusNeutral 字 4.12:1 破 4.5 线，对比度测只跑默认两档抓不到

## 现象/根因

statusNeutralTint 固定 16% alpha 叠各深色 surface0，ghosttyDark 底最亮→字/底 4.12；ownership-badge.test.tsx:254-258 BANDS 只枚举 light/dark，六个可选变体全盲（B8-07 变体零渲染盲区的量化实例）。

## 修复方向（编排者裁定=A）

token 层：statusTints 随各深色 surface0 反算 alpha 保对比下限（全变体受益）；BANDS 改遍历主题注册表全量。

## 验收

全主题矩阵测：徽标/未知 pill 字≥4.5 且底/行≥1.15（ghosttyDark 修复前 4.12 必红、claudeDark 4.86 边界入测）；Ghostty 真机帧一张。
