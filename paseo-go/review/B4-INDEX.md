# 批次四 Review INDEX（2026-09-30）

> 范围=210287d3e..6202f3c06（批次四全部实现 commit）。四维 reviewer：Correct/Tests/UI/Hygiene。
> 状态：open→confirmed/rejected→fixing→done。P0/P1 复审销卡制。

| #     | 级  | 标题                                                                        | 来源     | 复核      | 状态 | 批次     |
| ----- | --- | --------------------------------------------------------------------------- | -------- | --------- | ---- | -------- |
| R4-01 | P1  | 失败轮后 watcher 滞留→paseo 收尾字节记为外变→自家会话假「外部·运行中」+弹窗 | Correct  | 待        | open | A-server |
| R4-02 | P2  | 预览 slice(0,120) 劈代理对；live vs replay 预览分叉（探针实锤）             | Correct  | 待        | open | A-server |
| R4-03 | P2  | 启动发现丢弃新基线→daemon 停机窗口的外部写永久漏判                          | Correct  | 待        | open | A-server |
| R4-04 | P2  | 零消息会话元行浮顶时间序                                                    | Correct  | 待        | open | A-server |
| R4-05 | P2  | en 文案破 segment 三档宽度预算（300dp 溢出/380-405 电话标题饿死）           | UI       | 待        | open | B-chats  |
| R4-06 | P2  | 导入徽标跳转绕 C4 opener（无已读戳/无 C24 fork 警告）                       | UI       | 待        | open | C-import |
| R4-07 | P2  | 裁定 15/F9 返回键退搜索三无（漏拆卡，Main 责任）                            | UI+Tests | n/a(自证) | open | C-import |
| R4-08 | P2  | 裁定 14 弹窗帧名实不符（08-r4-dialog 无弹窗）=KI-9 模式复现                 | Tests    | 待        | open | B-chats  |
| R4-09 | P2  | F10 修复与 ruling③ 注释矛盾；顶部下拖场景测帧双无                           | Tests    | 待        | open | B-chats  |
| R4-10 | P2  | codex rollout 扫描边界切片错位=有界走查变每 sweep 全树重走                  | Hygiene  | 待        | open | A-server |
| R4-11 | P3  | icon 档 segment 触达 38x42<44                                               | UI       | 轻        | open | B-chats  |
| R4-12 | P3  | 孤儿组头折叠触达 ~31dp                                                      | UI       | 轻        | open | C-import |
| R4-13 | P3  | TalkBack 听不到草稿/预览副标题                                              | UI       | 轻        | open | B-chats  |
| R4-14 | P3  | en 术语漂移 'Back to active' vs 'In progress'                               | UI       | 轻        | open | B-chats  |
| R4-15 | P3  | 星期档随设备 locale、昨天档随 app 语言=混语                                 | UI       | 轻        | open | B-chats  |
| R4-16 | P3  | 死键 chats.hostsMenu                                                        | UI       | 轻        | open | B-chats  |
| R4-17 | P3  | 裁定 12「高亮主机段」子句丢失且测钉窄契约                                   | Tests    | 轻        | open | C-import |
| R4-18 | P3  | 注释 F10/F11 标签写反两处                                                   | Tests    | 轻        | open | B-chats  |
| R4-19 | P3  | containerStyle 恒半契约无测试                                               | Tests    | 轻        | open | B-chats  |
| R4-20 | P3  | EACCES/EPERM 误读为共享占用→假 looksActive                                  | Hygiene  | 轻        | open | A-server |
| R4-21 | P3  | claude 注册表 pid 未验证数字                                                | Hygiene  | 轻        | open | A-server |
| R4-22 | P3  | watcher 上限 64 无晋升/淘汰→新释放者长期只走 60s 慢路                       | Hygiene  | 轻        | open | A-server |
| R4-23 | P3  | tail 读缓冲无上界                                                           | Hygiene  | 轻        | open | A-server |
| R4-24 | P3  | 导入树中间父 chevron 不反映展开态                                           | Hygiene  | 轻        | open | C-import |
| R4-25 | P3  | 发布 config schema additionalProperties:false 拒新键                        | Hygiene  | 轻        | open | A-server |

## 需拍板（非缺陷）

- D1 claude fork-on-send 顺延尾巴卡 —— **Main 裁定：维持顺延**（已排队）。
- D2 identity-colors.ts 新导出=第 5 个上游文件触点 —— **Main 裁定：接受**（1 行导出+COMPAT 注释），触点台账补记。
- D3 R4 门与 C24 fork 门双弹叠加 —— **Main 裁定：保留**（各证各风险；嫌吵再裁）。

## 复核庭终局（RevCourt 2026-09-30）

21 CONFIRMED / 1 DOWNGRADE（R4-08→P3：B4-R4OPEN/01-dialog.png 已真机证弹窗，余帧改名+勘误）/ 0 REJECTED / 0 UPGRADE。R4-01 影响修正：主链假态=「外部」徽标（looksActive 被归零不弹窗），stored 竞态变体可达「外部·运行中」；附加=失败轮重复 append 常驻时间线。

## 复核庭新增（待 Main 处置）

R4-26 崩溃残留注册表 pid 回收假活（并入 R4-21 修复面）；R4-27 attach 失败路径抹已有证据（A 批注意）；R4-28 跨主机 agentId 命名空间（记尾 chore）；R4-29 C9 搜索面检索字段缺口（记尾 chore）；R4-30/31 两条路径信任链细节（A 批顺核）。

## 拍板（Main，无人值守授权内）

D1 claude fork-on-send=维持顺延尾卡；D2 identity-colors.ts 第 5 触点=接受入账；D3 双弹窗叠加=保留。R4-08 处置=帧改名+勘误行（B 批带上）。R4-28/29 立尾 chore。

## 追加排队

- B4-LANG（语言传播断链查证，RevUI 现场，pre-existing）→ FixB 后派；R4-05 en 帧复验并入其尾项。

- C 批口径扩：R4-06+R4-32 并案「开屏=危险时刻覆盖面收口」——import 徽标跳转走 createChatOpener 全链（构造清单见 agent://B4R4Open 转案），通知 tap 挂 decideOwnershipSendWarning 纯函数门（取消=不 navigate 不 dismiss）。
