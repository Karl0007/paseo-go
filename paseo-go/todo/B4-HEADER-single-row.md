# B4-HEADER: 三 tab 单行顶栏（F1/F2/F3）

来源：BATCH4-ALIGNMENT.md F1/F2/F3（裁定 1/2 + Q1/Q2）。

## 口径

1. `shell-tab-header.tsx`：废 accessory 带，单行定高 bar(44)+衬(8+8)≈60dp；等高契约测试改钉新常量；inset 一次纪律不变。
2. `chats-header.tsx`：segment 上移 bar 行右槽；胶囊文案「● 1/1」（`hostsOnline` 键改计数版，圆点保留，无主机仍「无主机」）；搜索态 morph 行为不变。
3. segment 三级降级：全称→「活跃/归档」→纯图标（归档计数三档都在）；断点按实测列宽（MatePad 分栏列取证写卡报告）。
4. workspace/me 头 accessory 传空处清理；locales zh/en；C12 44dp 触达在单行内复核。

## 验收

门禁+scoped shell 绿；真机帧：三 tab 等高单行、工作区空白消失、胶囊计数态、segment 三档（含窄列）；F10 修复后长按在帧中不误伤（若 B4-REGRESS 未完，报 Main）。
