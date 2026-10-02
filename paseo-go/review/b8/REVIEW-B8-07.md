# REVIEW-B8-07 [P2] F22 tint 测钉桩主题字面值，token 引用与硬编码 hex 不可分（纸面护栏）

## 现象

把 theme.statusSuccessTint 换成同值 hex 全测绿——F22 明令禁止且测注释自称能抓的回归抓不到；dark 带全库零渲染。

## 根因

`ownership-badge.test.tsx:126-143` 断言当前 token 字面值；`test-stubs/react-native-unistyles.ts:80-97` StyleSheet.create 用固定 light testTheme 急切求值。

## 修复方向

哨兵法：vi.resetModules + 先改 stub token 为哨兵色再重导入渲染，断言渲染色跟随；或 stub create 记录 theme 键读取（Proxy）断言 pill 样式读过 tint 键。

## 验收

哨兵用例对现组件必绿；任一 token 换同值字面量后必红。

## 复核（RevB8）

**CONFIRMED（维持 P2）** — 两声称逐一核实。①同值 hex 不可分：stub `StyleSheet.create` 用固定 testTheme 急切求值（react-native-unistyles.ts:88-90），测（ownership-badge.test.tsx:129/135/141）断言的是 token **字面值**——组件样式块把 `theme.colors.statusSuccessTint` 换成 `"#15803d1f"` 后渲染色逐字节相同，全测必绿；测注释自称「catches ... a hardcoded hex」只对异值回退成立，同值字面量正是 F22 明令禁止且唯一测不出的形态。②dark 带零渲染：stub 硬编码 `colorScheme:"light"`、`setTheme:()=>undefined`，全库 tint 引用仅此一个测文件，无任何 dark 渲染路径。另注意 stub 的 tint 值（#15803d1f）与 theme.ts 现值（#3e704a1f）本就不同源，stub 漂移同样无测可拦。哨兵/Proxy 修复方向可达。
