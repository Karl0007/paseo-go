# REVIEW-B8-02 [P1] workspace/me 环换页表面未挂 ring.surfaceStyle，跟手动画整屏不可见

## 现象

在工作区/我的上横滑，跟手位移/出场/进场/回弹全部不可见，提交瞬间跳变；四格两两不一致（chats 可见）。

## 根因

`workspace-screen-body.tsx:964`、`me-screen-body.tsx:378` 只挂静态 `styles.swipeSurface`；`ring.surfaceStyle` 全库仅 chats-screen-body.tsx:822 一处消费（编排者 grep 复核证实）。

## 修复方向

两处改 `style={[styles.swipeSurface, ring.surfaceStyle]}`（与 chats 同款）。

## 验收

渲染断言两屏 swipeSurface 节点样式含 animated transform（修复前必红）；真机帧一张（工作区横滑中途跟手位）。
