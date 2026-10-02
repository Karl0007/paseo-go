# REVIEW-B9-06 [P2] 计数衰减的 manager 提交/发射层零覆盖（stored 3→0 与 live settled）

## 现象/根因

`??`→`||` 型 falsy 吞 0 回归下徽标永卡旧值而全套测仍绿：agent-manager.ts:621-631 stored 提交与 :4201-4215 live countMoved/settled 分支无测驱动（agent-ownership.test.ts 只测 0→1 truthy 翻转）。

## 修复方向

扩 SUBACT describe：utimesSync 出窗→sweep+flush 断言 stored=0+updatedAt 不变+dispatch 载荷带 0；live 侧一例断言衰减再发一次 agent_state。

## 验收

`??`→`||` 与 settled 删 ela 比较两变异下必红，现状绿。
