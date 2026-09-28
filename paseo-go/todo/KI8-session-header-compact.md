# KI-8 会话屏顶栏：压矮 + 双行（项目·分支 / 小字标题）（用户拍板 2026-09-29）

## 用户裁定（原话+截图1）

「顶部区域太高，短一点，显示方式改为**首行是项目-分支，下面有一行小字是真正的标题**。」

## 现状事实（编排者已核）

`src/shell/components/shell-session-header.tsx`（C14/C21 胶囊，浮在官方会话屏上的全宽栏）：
高度=`insets.top + topPad(8) + inner(56 compact/36 wide) + tabRowCover`，
单行=会话标题（长句截断）+ 状态点 + ⋯ 菜单 + 返回。用户实测=偏高、信息密度低。

## 实现口径

1. **双行内容**：
   - 首行（主字重）：`<项目名> · <分支>`——项目=现有 workspace label 来源；
     分支=`checkout_status.currentBranch`（runtime 已有该查询，文件屏在用；
     **非 git 仓/查询未回=只显项目名**，不显占位符、不闪骨架）；
   - 次行（小字 muted）：会话真标题（现有 title 来源），单行截断。
2. **压高度**：inner 56 → 以两行文本实测收（目标 compact 总高 ≤ 现高 -8dp；
   用现有 token 字号，别自造 size）；wide 形态同步双行（36 起量，同样收紧）。
3. 返回键/状态点/⋯ 菜单位置与命中区不动；C21 边缘手势带、C14 Portal 机制不碰；
   状态点跟首行对齐。
4. i18n：无新文案（分支名是数据）。

## 验收（证据契约四项）

1. app typecheck + oxlint 零错误。
2. 既有 shell-session-header/visibility 相关测试无新增失败；app 套件失败集=W1 零新增。
3. 真机（MatePad）：git 仓会话=两行（项目·main / 标题）；非 git 会话=首行仅项目名；
   长标题截断不破版；宽屏形态同款；与改前同屏截图对比高度可见变矮。
4. 读图 ≥3 存 `paseo-go/evidence/KI8/`（含改前/改后对比帧）。

## 依赖与纪律

- 与 KI-9 同文件（shell-session-header.tsx）→ **排 KI-9 之后**。
- 恰好一次 commit；报告 JSON。
