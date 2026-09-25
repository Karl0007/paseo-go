# C1 缝隙 + Paseo Go 骨架 + 四项前置验证

## 背景 / 用户拍板

DESIGN.md §2（两个缝隙、新代码去处）、§3（IA）、§10（A1-A4 spike）、D3（品牌 Paseo Go / app.paseo.shell）。基线 = C0 完成后的 HEAD。

## 设计裁定（照此执行，不得重开）

- 缝隙1：`src/app/index.tsx` +≤5 行——`paseoGo.settings.shellMode`（AsyncStorage，同步读取用预加载快照）或 env `PASEO_GO_SHELL=1` 为真 → `<Redirect href="/(shell)" />`；默认 false，官方行为零变化
- 缝隙2：`app.config.js` ≤15 行——env `PASEO_GO=1` 时覆盖 name:"Paseo Go"、slug:"paseo-go"、Android package:"app.paseo.shell"、图标用 `paseo-go/assets/`（自制简洁图标：官方色系+G/纸飞机变体，亮暗两版）
- 新建 `src/app/(shell)/_layout.tsx`：底部 Tabs（对话/工作区/我的），图标+label 双语，主题走官方 token
- 新建 `src/shell/routes.ts`：按 DESIGN §2.3 形状，唯一路由出处
- 新建 `src/shell/config.ts`、`src/shell/stores/settings.ts`（zustand+AsyncStorage）
- 三个 tab 各建占位屏（后续卡填充），占位屏渲染真实数据源探针（见 spike）
- i18n：`src/shell/locales/{zh,en}.json` + `addResourceBundle` 注入，不动上游 locale

## 范围

- 动：两个缝隙文件；新建 `src/shell/**`、`src/app/(shell)/**`、`paseo-go/assets/`、`paseo-go/evidence/C1/`
- 不动：其他一切上游文件

## 工程约束

- spike 四项（DESIGN §10 A1-A4）结论写进 `paseo-go/SPIKE.md`（每项附证据：截图或 payload 摘要）；A3 失败要在 known_issues 明示，影响 C6 走向
- 验证 tab 骨架时顺带确认：从 (shell) push `OFFICIAL.agent(...)` 能进会话（A2）

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. app 包测试全绿
3. 真实运行：flag 关→官方首页原样；flag 开→Paseo Go 三 tab 骨架；装机图标名=Paseo Go；与官方 APK 共存安装成功
4. 读图：≥4 张（官方模式首页、壳模式三 tab、启动器双 app 共存、agent 路由 push 成功页）

- 恰好一次 commit；报告含缝隙 diff 原文
