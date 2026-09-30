# B4-OWNERSHIP-UI: 所有权 UI 全展示（F8 + 裁定 14）

来源：BATCH4-ALIGNMENT.md F8/裁定 14（UI 强制）。依赖 B4-OWNERSHIP-server + B4-ROW。

## 口径

1. 「外部」徽标：对话行（标题行）+会话屏薄顶栏；一眼可辨三态（paseo/none 无徽标，external 有）。
2. R4 警告弹窗：external+looksActive 时发消息前弹「可能正在外部运行…取消/仍要发送」；仍要发送=照常。
3. R3 可见性：外部续写→列表未读红点+预览刷新（免手动刷新）；R5 翻转可见（徽标消失）。
4. 视觉细节执行 agent 自设计（守 token/i18n）；zh/en。

## 验收（裁定 14 硬线）

真机帧：三态分辨 + 外部续写免刷新生效 + 警告弹窗 + 转原生后徽标消失；缺一不过。

## 调研回写（Main 采纳，R4 按 provider 分级）

- **claude**：external+looksActive 发送=**自动 --fork-session**（零丢失双线并存），弹窗改为告知式「已为你分叉新会话」+可点进原会话。
- **omp/pi**：维持警告弹窗+「仍要发送」（发送=抢回最后叶）。
- **codex**：警告文案弱化为「对方将看不到你这条消息」。
- **opencode**：免弹窗直接放行（共享 DB 互相可见）。
- 分级表读 RESEARCH-provider-dual-write.md 结论节，文案 zh/en。
