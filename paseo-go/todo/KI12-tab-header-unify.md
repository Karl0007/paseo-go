# KI-12 三 tab 顶栏统一：等高 + 固定不随滚动（用户拍板 2026-09-29）

## 用户裁定（原话）

「首页的对话/工作区/我的三个页签，**顶部逻辑和高度都不统一**，理论上应该都是
**固定一致高度，不会随着上下滚动移动**。」

## 现状事实（编排者已定位，卡内为准；细节以你读码为准）

三屏 header 各自为政（C30 裁定「每个 body 自带 header」的遗留分化）：

- 对话：`src/shell/components/chats-header.tsx`（搜索/＋菜单那一条）；
- 工作区：`workspace-screen-body.tsx` 内嵌 `workspace-host-header.tsx`（N/N 主机在线+刷新）；
- 我的：`me-screen-body.tsx` 的标题行——**疑似在 ScrollView 内部**（会随滚走，待钉死）。
  高度、垂直节奏、滚动行为三者不一致=用户所报根因候选。

## 实现口径

1. **抽统一容器** `src/shell/components/shell-tab-header.tsx`：固定内容高（现三屏最高者
   取齐或按 token 定 52~56dp，读码后定值并在报告注明）、status-bar inset 只加一次、
   左标题/右槽位 API、底部 border token 同款。**三屏 header 全部换成它**，
   各自控件（搜索/＋/主机态/刷新）作槽位塞入，功能零回退。
2. **固定不滚动**：三屏结构=header 在 ScrollView/FlatList **之外**（列表内容从其下方开始，
   `ListHeaderComponent` 里不许再放顶栏级元素）。逐屏核查现状，谁在滚动容器里就把谁搬出来。
3. **宽窄两态一致**：宽屏列表列（TabletListColumn）里同一 body 复用，头栏同高同固定；
   竖屏切栏淡入（KI-9）与本卡容器兼容（header 参与整屏淡入即可）。
4. 视觉：三 tab 顶栏底边线、标题字号字重、左右 padding 全部同 token；「我的」若原无
   控件仅标题，保持仅标题但**同高**。

## 验收（证据契约四项）

1. app typecheck + oxlint 零错误。
2. 既有 chats/workspace/me 相关测试无新增失败；app 套件失败集=W1 基线零新增；
   新容器若有纯逻辑（高度/inset 计算）配单测。
3. 真机（MatePad，车道=`evidence/KI4/device-lane.md`）：三 tab 各拍一帧**同屏对比等高**
   （像素量高写入报告）；每 tab 滚到底再回顶，顶栏纹丝不动（滚动中帧为证）；
   宽屏列表列同款一帧；＋菜单/搜索/刷新功能回归。
4. 读图 ≥4 存 `paseo-go/evidence/KI12/`。

## 依赖与纪律

- 文件域：chats-header / workspace-screen-body / me-screen-body / 新 shell-tab-header。
  与 KI-11 相交于 chats 域（其动 body 内行交互）→ **排 KI-11 之后、KI-9 之前**。
- 恰好一次 commit；报告 JSON。
