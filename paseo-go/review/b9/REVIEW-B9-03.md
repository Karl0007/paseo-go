# REVIEW-B9-03 [P1] 子任务×N 词串徽标撑爆标题行右缘，盖四态灯与 ⋯（编排者帧证亲验）

## 现象

带徽标行：标题 0 宽、四态灯与 ⋯ 被浅染胶囊覆盖（f6-chat-row.png 像素实测越线 197px + 编排者读图确认）。jsdom 无布局引擎故 CI 全绿。

## 根因

chat-list-row.tsx:756-765 无界本地化词串塞进全 shrink-0 右缘组（:704-709）；count pill 几何按数字档设计，词串撑成 63dp 胶囊。叠未读 pill 时 zh 亦必溢出（427>388px）。

## 修复方向（编排者 D6 裁定）

徽标内容改**图标+数字档**（lucide users 字形+计数，宽度与 count pill 同档），「子任务」语义退 a11y label+长按菜单；右缘组恢复「不得超出标题行盒子」不变量；禁 maxWidth 特判。断言从 flexShrink 代理升级为**宽度预算求和**（running+pending 1+subagents 2+短标题，最窄侧栏宽下 Σ≤可用宽，现值 427>388 必红）。

## 验收

宽度预算测修复前必红；真机 bounds 帧（徽标右缘≤行右缘、灯/⋯ bounds 不被覆盖）zh+en 各一；f6 场景重拍。
