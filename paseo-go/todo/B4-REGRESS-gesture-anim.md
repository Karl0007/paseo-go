# B4-REGRESS: 长按失效+转场无动画 并案回归修复（P0）

来源：BATCH4-ALIGNMENT.md F10/F11（裁定 16/17）。用户现装=go.6 本机 release（merge 后）；两能力在 v0.3.0（merge 前）真机验收完好。

## 口径

1. 第一步：`git diff db4fd334..HEAD -- packages/app/package.json` 查 gesture-handler/reanimated/navigation 版本跳；命中→按新 API 适配壳侧用法（**优先改壳代码，不 pin 上游 package.json**；确需 pin=触点申报）。
2. 长按断点定位：press 计时→菜单 host（ShellRowMenuHost）挂载→gesture 激活链；修复 KI-16 250ms 菜单 + KI-11 菜单→拖动接力。
3. 动画断点定位：栈 screenOptions/上游转场件；排除 MatePad `window_animation_scale`（先查系统值）。
4. 真机三态帧：长按出菜单 / 拖起换位 / 点击不误触；转场连拍帧（push 中间态存在）。
5. 修完重打 release APK 装机复验（用户日常包=验收面）。

## 验收

门禁绿+套件对照零新增+真机帧（菜单/拖动/转场）+release 包复验帧；known_issues 列 F5 横滑是否受同根因牵连（若牵连，报 Main 更新 B4-SWIPE 卡）。
