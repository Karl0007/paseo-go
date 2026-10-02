# REVIEW-B8-05 [P2] AVATAR_FILL 双份真相（import.tsx 手抄 chat-list-row）

## 现象

调色改版时两屏同项目底色静默漂移，F23「同项目同色」口径失去机器保证。

## 根因

`import.tsx:124-126` 与 `chat-list-row.tsx:149-151` 逐字节相同的两份 AVATAR_FILL；注释自称「同一张表」实为复制。project-avatar.ts 已暴露 colorName/color，天然归属地在此。

## 修复方向

AVATAR_FILL 上收 `shell/chats/project-avatar.ts` 导出，两消费方 import，删两份本地 const。

## 验收

跨文件一致性断言（同 colorName 两路径 backgroundColor 相等）；变异：任一份换常量→必红。

## 复核（RevB8）

**DOWNGRADE→P3** — 代码事实成立（两处 `Object.fromEntries(IDENTITY_COLOR_NAMES.map(name=>({backgroundColor:identityColor(name)})))` 表达式重复，import.tsx:124-126 / chat-list-row.tsx:149-151），但声称的因果不成立：两份都是**从同一真相源 `@/styles/identity-colors` 现推导**，非手抄 hex——调色改版改 IDENTITY_COLORS，两屏自动同动，「静默漂移」无触发路径；且 import.test.tsx:107 已把行底色钉到 `identityColor(colorName)` 函数本身，F23 机器保证仍在。残余价值=DRY 上收 project-avatar.ts（顺带消掉「改一处推导、另一处忘跟」的人为窗口），属 P3 清理项。
