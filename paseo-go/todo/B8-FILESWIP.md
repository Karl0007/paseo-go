# B8-FILESWIP 文件页三段并入横滑（F29）

## 口径（用户+编排者拍板）

1. 文件页三段（文件/变更/提交，`shell/files/files-tabs.ts`）**屏内线性非循环**横滑切换，跟手动画与主环同参数组（tab-ring 阈值 16dp slop/1/4 宽/500dp/s 尾速）。
2. **边界级联**：最左「文件」右滑外抛=栈页((detail)/files)走 F27 返回、工作区 tab 实例走主环（workspace→archived 方向）；最右「提交」左滑外抛=工作区 tab 走主环（workspace→me）；栈页最右无外抛（左滑在栈页恒 FAIL=环不响应，保持 F27 语义）。
3. 段内横向可滚内容声明豁免（HorizontalScrollContext 同款）；非 git checkout 灰两段=无内滑只剩外抛；垂直滚动/长按/搜索态互斥沿用。
4. 双实例都生效（(shell)/files 隐藏实例 + (detail)/files 真栈页），共用同一 body 手势层。

## 实现提示

复用 shell/gestures 底座：新 use-files-segment-swipe（内 pager，算术可借 tab-ring 线性化）+ decideShellSwipe 仲裁扩展（内层消费/边界外抛经 frontmost/gate 总线，勿与 stack-back/ring 双手势打架——**单仲裁器原则**，扩展 decideShellSwipe 或前置内层决策）。级联=同一触摸流内移交还是让位下一次手势，以 RNGH 语义可行解为准（卡主定，验收以行为为准）。

## 验收

- 单测：段切换/边界外抛谓词/灰段退化/豁免判定（修复前必红新断言）。
- 真机帧：工作区 tab 上 文件→变更→提交 跟手中途帧 + 提交段左滑继续进「我的」（级联实锤）；栈页 files 右滑返回仍好（回归）。
- scoped gestures/session-header/tablet/files 绿+typecheck+oxlint。**恰好一次 commit**（令牌制）。
