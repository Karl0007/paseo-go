# B4-LANG: 官方设置切语言后壳 UI 传播查证（RevUI 现场观察，pre-existing）

来源：review 轮 RevUI 真机留言（经 RevCourt 转报，2026-09-30）。

## 现象

官方设置切 English 后壳 UI 未实时跟随（仍中文）。不在批次四 25 卡内，疑似 pre-existing。

## 口径

1. 查证传播链：官方 i18n 语言态→壳 `SHELL_I18N_NAMESPACE` 资源挂载/`useTranslation` 重渲染；区分「需重启才生效」vs「永不生效」两档定级（永不=i18n 零缝隙铁律破口=P1 级查证）。
2. 断链则修（壳侧优先；确需官方侧=触点申报）。
3. 尾项（承接 R4-05）：修好后补 en 现势的三档真机帧复验。
4. 帧：切语言即时/重启后 壳三 tab 文案对照。

## 验收

定级结论+修复（如需）+对照帧；恰好一次 commit。

## 结论（B4Lang，2026-10-01）

**定级=介于两档之间的第三态：实时传播不可靠（部分/全部表面滞后到下一次无关渲染），非「永不」→ 已修（壳侧）。**

- 传播链读通：官方设置 `updateSettings({language})` → `queryClient.setQueryData`（同步）→ `I18nProvider` 重渲染 → **渲染期** `ensureI18nLanguageForRender`→`i18n.changeLanguage()`（i18next 同步 emit `languageChanged`，实测）→ react-i18next v17 `useSyncExternalStore` 订阅者的 store-change **在 React render phase 内 setState** → React 丢弃/推迟这些更新（设备 LogBox 实锤：`Cannot update a component (ToastProvider) while rendering a different component (I18nProvider)`）。
- 断链点=官方 provider 渲染期副作用（`i18n/provider.tsx`，上游文件，未动=零触点）；壳 `paseoGo` 资源注册（`addResourceBundle`，模块导入期）与 useTranslation 绑定本身无缺陷。
- 真机复现（修复前）：zh→en 后 2s 壳升级横幅仍中文（其余面已英文，滞后到下次导航渲染才跟上）；en→zh 后 1.2s **整棵可见树**仍英文，~4s 靠无关渲染（LogBox 重渲染）才收敛。重启必跟随（语言持久化+首帧即正确）→ 非「永不」。
- 修复（壳侧，`shell/i18n.ts`）：`attachLanguageRebroadcast` —— `languageChanged` 后在宏任务补发一次同名事件（pending 标志自吞回声、必终止），让所有订阅者拿到干净的 event-time 更新，一轮渲染内收敛。官方面同享此网。
- 残留（官方侧，known issue 上报）：渲染期 `changeLanguage` 的 LogBox 报错 toast（仅 debug 构建可见）根因仍在 `i18n/provider.tsx`；正解=官方把副作用挪出渲染期，但那是上游触点且有首帧闪语言风险，本卡不动。
- 测试：`shell/i18n.test.ts` 3 例（补发恰好一次/自终止/detach；官方实例上 `paseoGo:tabs.chats` 随切换重解析 Chats↔对话）全绿。
- 帧（en 现势三档头栏，承接 R4-05）：`evidence/B4-LANG/f1-lg300.png`（300dp 列短称档 Active/Arch.1，＋在列内）、`f2-md260-icon.png`（260dp 列图标档，计数保留）、`f3-compact640.png`（紧凑全称档 In progress/Archived 1 + 标题完整）；对照修复前后：`02/07`（滞后证据）vs `11/17`（修复后 ≤1s 收敛，CJK 扫描=0）。
- 环境坑（非本卡缺陷）：bash cwd 盘符小写 `c:/` 时 vitest 全库 describe() 即炸（Windows 盘符大小写→模块图双实例，`@vitest/runner` 单例未初始化）；用 `C:/` 即好。
