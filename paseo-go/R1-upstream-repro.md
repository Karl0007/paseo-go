# R1 upstream minimal repro — `useHostRuntimeConnectionStatuses` freezes under React Compiler

日期：2026-09-25 ｜ 发现：C2 真机验收 ｜ 定位+实证：R1 卡 ｜ 状态：官方代码缺陷，影响 release（壳侧已缓解）

## TL;DR

`packages/app/src/runtime/host-runtime.ts:2505-2524` 的聚合状态 hook 用
`void version;`（L2517）+ 显式 deps 数组声明"version 变了就重算"。本仓库
`packages/app/app.config.js:191` 开启了 `experiments.reactCompiler: true`
（babel-preset-expo → `babel-plugin-react-compiler@1.0.0`，react 19.1.0 / RN 0.81.5 / expo 54）。
React Compiler 重新推导 memo 依赖时**不把 `void version` 计为读取、并忽略手写 deps 数组**，
编译产物只在 `serverIds` 数组身份变化时重算 Map：

```js
// compiled (babel-plugin-react-compiler, target 19)
let t4;
if ($[5] !== serverIds) {
  // ← version 不在条件里
  const entries = serverIds.map(t5); // t5 读 store.getSnapshot(...)
  t4 = new Map(entries);
  $[5] = serverIds;
  $[6] = t4;
} else {
  t4 = $[6]; // ← 永远返回陈旧 Map
}
return t4;
```

后果：只要"host 列表最后一次变化"那一刻 controller 还在 `connecting`（booting 快照默认
`connecting`，host-runtime.ts:409-417），返回的 Map 就**永久冻结在 connecting**——
transport 层完全健康（WS 心跳/推送/目录同步照常，store `getSnapshot()` 直读=online），
但所有消费聚合 Map 的 UI 把在线 host 归为离线/连接中。

## Minimal repro（无需重启 daemon/metro，全新安装即可）

1. `reactCompiler: true` 的 dev 或 release 构建，全新存储启动 app（`pm clear` 或首启）。
2. 欢迎页 → 直接连接任一在线 daemon。
3. 观察：聚合状态 UI（如 add-project 流程、schedules、壳对话 tab 胶囊）显示"连接中/离线"，
   同时 `getHostRuntimeStore().getSnapshot(serverId).connectionStatus === "online"`，
   每-host hook `useHostRuntimeConnectionStatus(serverId)` 也返回 `online`。
4. 任意改变 host 列表身份（如 `renameHost()`）→ UI 立刻变在线。此后 daemon 重启
   （down→up）UI 不再跟随（`serverIds` 身份不再变化）→ 永久陈旧。

C2 现场（metro 重启+daemon 重启后卡 connecting、`pm clear` 后仍复现、官方 UI 同样表现、
同 render 三路 map=connecting / per-host=online）全部由此机制解释：三路里"map"是编译后
冻结的 memo，"per-host"是直接 `useSyncExternalStore`（无 memo，正确），当时直读
snapshot=connecting 是 daemon 重启窗口内的真实瞬时值被一次性打印。

## 建议上游修法

把 version 作为真实数据输入参与读取（壳侧缓解同款，
`packages/app/src/shell/runtime/use-shell-host-statuses.ts`，编译产物条件为
`if ($[5] !== serverIds || $[6] !== version)`，已验证）：

```ts
function readStatusAt(store, serverId, version) {
  if (version < 0) return "connecting"; // version 是真实操作数，编译器必须保留依赖
  return store.getSnapshot(serverId)?.connectionStatus ?? "connecting";
}
```

或改用 per-host `useSyncExternalStore` 值订阅。任何形式的 `void x;` 再依赖手写 deps
数组的写法在 React Compiler 下都是无效的。

## 受影响调用点（截至 de77bd58）

- `src/components/add-project-flow.tsx:321`（官方）
- `src/hooks/use-schedules.ts:44`（官方）
- `src/screens/new-workspace-screen.tsx:1337`（官方）
- `src/app/(shell)/chats.tsx`（壳，已切换到 `useShellHostStatuses`）

## 取证（本机）

- 复现：全新启动+直连后，store=online/version 持续递增，ChatsHeader fiber
  `memoizedProps.statuses=["connecting"]`；手动 `store.emit()` 与直接调用全部
  globalListeners 均不改变 UI；`renameHost()`（serverIds 身份变化）→ 立即 `["online"]`。
- 缓解后：重启 daemon，UI 逐拍跟随 store：error→connecting→error→online（4s 采样）。
- 截图：`evidence/R1/`（复现态 0/1 与缓解后 1/1）。
