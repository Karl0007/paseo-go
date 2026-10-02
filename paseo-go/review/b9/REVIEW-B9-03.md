# REVIEW-B9-03 [P1] 子任务×N 词串徽标撑爆标题行右缘，盖四态灯与 ⋯（编排者帧证亲验）

## 现象

带徽标行：标题 0 宽、四态灯与 ⋯ 被浅染胶囊覆盖（f6-chat-row.png 像素实测越线 197px + 编排者读图确认）。jsdom 无布局引擎故 CI 全绿。

## 根因

chat-list-row.tsx:756-765 无界本地化词串塞进全 shrink-0 右缘组（:704-709）；count pill 几何按数字档设计，词串撑成 63dp 胶囊。叠未读 pill 时 zh 亦必溢出（427>388px）。

## 修复方向（编排者 D6 裁定）

徽标内容改**图标+数字档**（lucide users 字形+计数，宽度与 count pill 同档），「子任务」语义退 a11y label+长按菜单；右缘组恢复「不得超出标题行盒子」不变量；禁 maxWidth 特判。断言从 flexShrink 代理升级为**宽度预算求和**（running+pending 1+subagents 2+短标题，最窄侧栏宽下 Σ≤可用宽，现值 427>388 必红）。

## 验收

宽度预算测修复前必红；真机 bounds 帧（徽标右缘≤行右缘、灯/⋯ bounds 不被覆盖）zh+en 各一；f6 场景重拍。

## 复核（G2aRow 执行中，Main 裁定 B→A 定妆）

执行中发现 pill 无界词串为同根第二成员，扩权已获 Main 裁定 B（OwnershipBadge numberOfLines=1+flexShrink:1 二级泄压阀；预算测同步加「可截成员截断后 ≤ 行盒」+ pill 唯一二级可缩断言）。

0.01 实验（真机 AHPEBB1826005071 实测钉死，本仓首次验证该语义差异）：pill flexShrink:0.01 想让截断顺序化（title 冻结后才轮到 pill），**原生 Yoga 不复现 CSS 规范的冻结-再分配**——比例阶段 title 份额封顶后剩余溢出不转给 pill，f6 行 pill 保持全宽 287px、徽标再次被推出行缘（uiautomator dump 徽标节点缺位）；普通行 pill 全词则恢复。据此 Main 拍板 A=回 flexShrink:1（唯一满足「徽标右缘≤行右缘、灯/⋯ 净空」硬不变量的已验证态），普通行 pill 比例截断为已裁定代价，词面根治另立 G3 卡（spinner 承载运行中+pill 词面缩短为纯状态词）。
