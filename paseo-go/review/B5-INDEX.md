# 批次五 Review 台账（B5-INDEX）

> 范围=76d71f1a3..da8489125 六枚实现提交。双维 reviewer（RevApp/RevServer），无 contested 项故不设复核庭——**修复车内置红测复核**：复现不了=REJECTED 附证据。

| ID  | 级别 | 标题                                                        | 域     | 处置              | commit    |
| --- | ---- | ----------------------------------------------------------- | ------ | ----------------- | --------- |
| S1  | P2   | 祖先剔除行不计入回填 count→default 态少给行                 | server | FIXED(红→绿)      | 42d438807 |
| S2  | P2   | 祖先链 read 拒绝（EISDIR/EIO）炸整个导入列表                | server | FIXED(红→绿)      | 42d438807 |
| S3  | P2   | nativeHandle 非字符串→TypeError 炸请求（官方客户端同灭）    | server | FIXED(红→绿)      | 42d438807 |
| S4  | P3   | 深度帽 32 静默截断→触顶 log 可观测                          | server | FIXED(红→绿)      | 42d438807 |
| S5  | P3   | 祖先认领 key 未走 sessionPathKey 折叠（Windows 大小写漂移） | server | FIXED(红→绿)      | 42d438807 |
| S6  | P3   | COMPAT 缺移除日期+「byte-for-byte」注释矛盾                 | server | FIXED(红→绿)      | 42d438807 |
| A1  | P2   | 拖拽取消无路径释放 band→滚动/刷新/切页冻结至下次触行        | app    | FIXED(红→绿/红帧) | b1f189524 |
| A2  | P3   | patch JS 侧 session 门卡顿下吞 drag() 成死手势              | app    | FIXED(红→绿/红帧) | b1f189524 |
| A3  | P3   | heldTranslate 归零与重排同帧竞态→落点 1-2 帧漂移            | app    | FIXED(红→绿/红帧) | b1f189524 |
| A4  | P3   | stickyPreview 他端删除会话条目永久驻留                      | app    | FIXED(红→绿/红帧) | b1f189524 |

- 复核者已证成立面（免修）：patch 失配响亮报错非静默；refreshControlPlan 非拖拽态=基线语义；sticky fold 键=行读键；本地删除/清数据双清；搜索 haystack 不受括号格式影响；ownership undefined/null→未知诚实；press_out INERT 对已提交落点自洽；协议两侧非 strict=旧端剥键安全；旧 17 测零改动全过；环断/不存在文件安全终止。
- 修复车：FixServer5（S 域）/FixApp5（A 域，持设备）。每车恰好一枚 commit。

## 终局（2026-10-01 晚）

10/10 FIXED，0 REJECTED。FixServer5 `42d438807`（六项红转绿，含 win32 门控测）；FixApp5 `b1f189524`（A1 实机红绿帧、A4 先红 7 例后绿 11/11、patch 重生成无残留）。scoped：server 38+24、protocol 66、client 1、shell 518 全绿。
