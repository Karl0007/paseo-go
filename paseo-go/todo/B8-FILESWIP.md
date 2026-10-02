# B8-FILESWIP 文件页三段并入横滑（F29）

## 口径（用户+编排者拍板）

1. 文件页三段（文件/变更/提交，`shell/files/files-tabs.ts`）**屏内线性非循环**横滑切换，跟手动画与主环同参数组（tab-ring 阈值 16dp slop/1/4 宽/500dp/s 尾速）。
2. **边界级联**（KI-9 后文件页仅 (detail) 栈实例，卡初稿「双实例」口径作废；手势层仍放共享 body，tabHosted 态以谓词单测钉住留待未来宿主）：**最左「文件」段+右滑=外抛走 F27 栈页返回**（中段右滑先回退左邻段，绝不回卷）；**最右「提交」段+左滑在栈页恒 FAIL 无外抛**（保持 F27 左滑不切环语义）。
3. 段内横向可滚内容声明豁免（HorizontalScrollContext 同款）；非 git checkout 灰两段=无内滑只剩外抛；垂直滚动/长按/搜索态互斥沿用。
4. ~~双实例~~ 单宿主=（detail)/files 栈页（KI-9 事实，F5 核对）；同流 fail 让位祖先面实现级联。

## 实现提示

复用 shell/gestures 底座：新 use-files-segment-swipe（内 pager，算术可借 tab-ring 线性化）+ decideShellSwipe 仲裁扩展（内层消费/边界外抛经 frontmost/gate 总线，勿与 stack-back/ring 双手势打架——**单仲裁器原则**，扩展 decideShellSwipe 或前置内层决策）。级联=同一触摸流内移交还是让位下一次手势，以 RNGH 语义可行解为准（卡主定，验收以行为为准）。

## 验收

- 单测：段切换/边界外抛谓词/灰段退化/豁免判定（修复前必红新断言）。
- 真机帧：栈页段间跟手中途帧；**最左段右滑级联 pop** 帧；普通页右滑返回回归帧。「提交段左滑进我的」以 tabHosted 谓词单测为证（无 tab 宿主，帧不可拍如实记）。
- scoped gestures/session-header/tablet/files 绿+typecheck+oxlint。**恰好一次 commit**（令牌制）。
