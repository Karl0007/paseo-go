# REVIEW-B8-10 [P2] 未知 pill 浅色主题底 1.10:1 近不可见、字 4.40:1 破 AA 线

## 现象

浅色主题「未知」底几乎看不出、文字比改前难读（4.83→4.40 <4.5@12px）；暗色过关；兄弟 tint 1.18/1.19 带色相。

## 根因

`ownership-badge.tsx:94-99` surface2 底+foregroundMuted 字 on surface0 行。

## 修复方向（编排者裁定=D6）

方案 A：按 statusTints 同规则生成中性 tint token（底与兄弟同强度、无色相），字色取过 AA 的中性深档。

## 验收

对比度计算进测：三态×明暗 字≥4.5:1 且底/行≥1.15:1（修复前浅色未知必红 4.40/1.10）；浅色+暗色各一真机帧。

## 复核（RevB8）

**CONFIRMED（维持 P2）** — 对比度按 theme.ts 现值独立重算（WCAG 相对亮度，node 脚本），卡片四个数字全部复现：浅色 底 surface2#f4f4f5/surface0#ffffff=**1.10**、字 foregroundMuted#71717a/surface2=**4.40**（<4.5，pill 字号 fontSize.sm=12px 属普通文本档）、改前字/surface0=**4.83**、兄弟底 success#3e704a@12%=**1.18**、warning#7b5d39@12%=**1.19**；暗色 底 1.20、字 5.82（过关，「暗色过关」亦真）。行底=chat-list-row.tsx:597 `surface0` 前提成立。F22 把未知从 outline（字直接上 row 底 4.83）改成 surface2 填充后字落到 4.40，浅色 AA 破线为用户可见退步；裁定 D6（中性 tint token 同强度+过 AA 字档）与「兄弟 1.18/1.19」的强度基准吻合。
