# KI-13 导入屏切主机后列表残留旧主机数据（KI-5 收卡转卡 2026-09-29）

## 现象（KI-5 真机实测发现，known_issue 转卡）

导入屏选中**旧/离线主机**后：状态条正确显示「请升级主机版本以支持导入。」，
但下方 FlatList **仍渲染上一台（正常）主机的会话行**——状态与数据源错位，
用户可能勾错再导入报错。

## 根因位点（KI-5 已定位）

`src/shell/import/use-import-list.ts` 的 serverId 切换语义 + `import.tsx` 的
`deriveImportStatus`/rows 渲染解耦：状态行走新主机判定，rows 未随切换清空/未挂新态。

## 修复口径（小卡，方向已定）

serverId 变更时：立即清空 entries/rows 与勾选集（进 loading/新态），旧数据零残留；
`alreadyImportedCount`/providerErrors 同步复位。use-import-list 已有 F1 stale-host 守卫，
补的是**清空语义**不是竞态守卫。单测：切换后 rows=[]、勾选清空、新响应到达才再渲染。

## 验收

1. typecheck/oxlint 零错；2. use-import-list 定向新用例绿 + 套件=W1 零新增；
2. 真机：双主机来回切，列表/勾选随切换清空再加载（切换瞬间帧）；4. 读图 ≥2 存 `evidence/KI13/`。

恰好一次 commit；排 KI-11 后、KI-9 前（import 域）。
