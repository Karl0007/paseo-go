# REVIEW-B8-07 [P2] F22 tint 测钉桩主题字面值，token 引用与硬编码 hex 不可分（纸面护栏）

## 现象

把 theme.statusSuccessTint 换成同值 hex 全测绿——F22 明令禁止且测注释自称能抓的回归抓不到；dark 带全库零渲染。

## 根因

`ownership-badge.test.tsx:126-143` 断言当前 token 字面值；`test-stubs/react-native-unistyles.ts:80-97` StyleSheet.create 用固定 light testTheme 急切求值。

## 修复方向

哨兵法：vi.resetModules + 先改 stub token 为哨兵色再重导入渲染，断言渲染色跟随；或 stub create 记录 theme 键读取（Proxy）断言 pill 样式读过 tint 键。

## 验收

哨兵用例对现组件必绿；任一 token 换同值字面量后必红。
