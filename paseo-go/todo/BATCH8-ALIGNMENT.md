# 批次八 对齐记录（用户反馈 → 查证 → 拍板 → 拆卡）

> 基线 HEAD=32a37f23e（go.10 已发，生产=go.9）。模式同前。

## 第一轮反馈（2026-10-02，手机 go.10 + 生产 go.9）

- **F21 布局参考微信**：行内**日期时间靠右对齐**（现在时间跟在 pill 后面左排）。微信范式=标题左、时间右上角小灰字。
- **F22 pill 配色更明显但不丑**：原生/外部/未知三态现在太素（neutral 底/outline）。方向=语义色**浅染色底+同系深色字**（原生=绿系、外部=琥珀系、未知=石板灰系），跟随主题明暗，禁高饱和大块色。
- **F23 导入屏布局参考会话页 + 徽标优先级**：①导入行版式对齐壳会话行（项目 icon、标题、时间右、副标题层级）；②**已归档的会话优先显「已归档」徽标**（现在被「已导入」盖住/并列不分主次）。
- **F24 数量不一致（疑 bug）**：用户感觉=壳会话列表的会话总数 与 导入屏的 已导入/已归档计数 对不上。需枚举差集定根因（候选：launch 原生 agent 的 handle 不匹配 transcript→不被标已导入；metadata 隐藏会话；扫描窗 500/limit 200 截断；已归档快照是否全进 claim 索引；会话列表含无 transcript 的 agent）。

## F24 只读定位（2026-10-02，未修，等齐反馈再拆卡）

现场数字（生产 6767）：

- 磁盘 omp transcript=**6597 个 .jsonl**；导入屏扫描窗=**limit 200/搜索窗 500**（壳侧常量）→ 绝大多数 transcript 根本不在返回集里。
- agent 数：默认 cwd 视图 8；`--all --global`=**29**（含归档）。
- 壳对话列表=跨目录全量 agent（含归档段）；导入屏「已导入/已归档」=**只对返回窗内命中的行打徽标**。

⇒ 计数口径天然不同轴：**列表数=全部 agent；导入屏徽标数=（agent ∩ 窗内 transcript ∩ handle 匹配成功）**。差集来源按嫌疑序：

1. 窗口截断（6597 里只扫 200/500）——老会话的 transcript 出窗，其 agent 在列表里但导入屏无行可标。
2. handle 匹配残余失配（跨机/路径漂移/大小写；B5-IMPORT2 已修祖先链+折叠，但只覆盖走链路径）。
3. 归档口径：壳「已归档 N」=存储真相全量；导入屏归档徽标=窗内命中。
4. metadata 隐藏会话在导入屏恒隐（拍板），若其 agent 在对话列表可见也会造成不对称（待核 internal 标记是否已把这类 agent 排除出列表）。

修复方向候选（拍板时选）：a) 导入屏加「已导入/已归档」**计数以服务端全量 claim 索引为准**（不依赖窗）+徽标仍只标窗内行；b) 分页/游标扩窗；c) 导入屏顶部加「共 N 个会话已是你的 agent」说明行消歧。

## 拍板（冻结 2026-10-02，用户「这波先修这些吧」）

| #   | 裁定                                                                                              | 卡         |
| --- | ------------------------------------------------------------------------------------------------- | ---------- |
| F21 | 时间贴行右缘（微信右上灰字），pill 紧随标题，长标题截断不挤时间                                   | B8-ROWPILL |
| F22 | pill 三态浅染色：原生=success 系/外部=warning 系/未知=中性石板，主题 token 双套禁硬编码 hex       | B8-ROWPILL |
| F23 | 导入行版式对齐壳会话行；徽标优先级 已归档>已导入                                                  | B8-IMPORT  |
| F24 | 方向 a+c：服务端响应加可选 claimedTotal（全量 claim 计数）+导入屏顶部消歧说明行；徽标仍只标窗内行 | B8-COUNT   |
| F25 | replica-cache 白名单补两轴三键，round-trip 无损                                                   | B8-CACHE   |
| F26 | 横滑线性环 [进行中→已归档→工作区→我的→循环]，前进=切右边页签手势，带动画（用户确认方向）          | B8-SWIPE   |
| F27 | 全部堆叠页全宽手指右滑=返回；横向可滚内容豁免；左缘带兜底                                         | B8-SWIPE   |
| F28 | watcher 顺 resume 链正向迁移（跟到新叶子文件），基线语义不回退                                    | B8-WATCH   |

波次：W1 并行 ROWPILL/CACHE/WATCH（设备道序 ROWPILL>CACHE>WATCH）→ W2 IMPORT→COUNT → W3 SWIPE 独占 → review 轮 → 终态门禁 → **release go.11 + 生产切换**（F24/F28 涉服务端）。
文件域核实：行=shell/components/chat-list-row.tsx；pill=shell/components/ownership-badge.tsx；导入屏=app/(detail)/import.tsx+shell/import/rows.ts；服务端=server/agent/import-sessions.ts、server/agent/transcript-watch-service.ts；手势=shell/chats/filter-swipe.ts、shell/session-header/edge-swipe.ts。

- **F21 拍板方向**：行版式=标题(截断)+pill 紧随，**时间贴行右缘**（微信右上灰字范式），副标题行不动。
- **F22 拍板方向**：三态=语义色浅染底+同系深字（原生绿/外部琥珀/未知石板灰），明暗主题双套，禁高饱和大块。
- **F23 拍板方向**：导入行版式对齐壳会话行；徽标优先级 **已归档 > 已导入**（归档态盖过导入态）。
- **F24 处置**：立案诊断+修复卡（口径 a+c 组合为默认推荐，待用户确认）。

## F25 原生→未知回跳（2026-10-02 09:4x，只读定位=已闭合，未修）

**症状**：本会话（live，转圈中）pill 先「原生」、下拉刷新后回「未知」。

**根因链（静态实锤）**：

1. 列表首载/活体事件路径带两轴（agent_update 全 payload、fetch 全量 entries 均含 ownership/origin）→ pill 正确。
2. 客户端 **replica-cache（持久化快照缓存）的 serializeAgent 白名单不含 ownership/externalLooksActive/origin**（replica-cache/index.ts:607-661 通篇无此三键；agent-snapshots.ts:153 注释自认「NOT projected back out by projectAgentSnapshot」）。
3. 刷新路径经 replica 缓存回水化（deserializeAgent 产出的 Agent 无两轴）+ directory-sync 代际游标下服务端**空增量**不再重发全量 → 两轴就此丢失 → pill 落「未知」。
4. B6-OWN-HEAL 当时把「不回投 strict replica cache」记为「冷缓存短暂未知」——**低估了**：不止冷启动，每次经缓存回水化的刷新都会回跳，live agent 也中招。

**修复方向（待拍板后拆卡）**：serializeAgent 白名单+StoredAgent 类型+deserializeAgent/projectAgentSnapshot 补三键（纯客户端）；回归测=「带两轴 agent 过一遍缓存 round-trip 后字段仍在」+真机刷新不回跳帧。

## F26 横滑切页签扩展为全链循环（2026-10-02；方向已确认=切到右边页签的手势为前进）

- 现态：B4-SWIPE 横滑只在对话 tab 内切 进行中↔已归档。
- 口径：横滑（带动画）沿**线性环** [进行中 → 已归档 → 工作区 → 我的 → (回)进行中] 前进/后退；方向语义与现有段内滑一致（同一手势方向从 进行中→已归档 延续到 已归档→工作区→我的→循环回进行中；反向往返）。
- 实现要点（卡内定）：tab 级手势层与段内滑统一成一个状态机（避免双手势打架）；切 tab 复用官方 tab 导航+滑动动画；工作区/我的 tab 内容区同样可滑出；边界循环双向；与垂直滚动/长按/拖拽/边缘返回手势的冲突审计沿用 B4-SWIPE 8 项清单扩展。

## F27 堆叠页全宽右滑返回（2026-10-02）

- 口径：**所有 (detail) 堆叠路由**（会话/文件/预览/导入/重命名/命令编辑/主机设置/添加项目…，非搜索态）内**手指向右滑=返回上一层**，不限于左缘 80dp 带（现有 edge-back 仅边缘触发且真人复验未闭环）。
- 全局语义统一：手指右=返回（堆叠页）/后退（tab 环）；手指左=tab 环前进。堆叠页上左滑不切 tab（返回栈优先）。
- 冲突审计（卡内必做）：横向可滚内容（代码块/图片/横向列表）不得被劫持——可滚子视图声明性豁免；与垂直滚动/长按拖拽/下拉刷新/搜索态互斥沿用 B4-SWIPE 清单；官方会话屏上的手势=壳手势层（Portal 浮层同款姿势）能挂多大范围以实测为准，挂不住官方滚动体的部分报 known_issue+边缘带兜底保留。
- 与 F26 同域（手势状态机），建议同车实施。

## F28 外部活跃会话不被识别/无实时进度（2026-10-02，导入屏截图圈行）

**症状**：IdleGame 的「我的图片评审…」会话=已导入 agent，用户**此刻正在 PC 终端跑着对话**，但导入屏只标「已导入」，无活跃/外部迹象，进度不实时。对照首行（本会话链）有「可能活跃」标。

**头号嫌疑（静态，待卡内实锤）**：**watcher 的 resume 链方向缺口**。B5-IMPORT2 修的是逆向认领（新文件的 claim→祖先文件）；而外部 `omp resume` 的写入落在**新 transcript 文件**（header parentSession→旧文件），agent 的 persistence/watcher 仍挂在**旧文件**路径上 → 新文件的写入对 watcher 不可见 → 不翻外部、不刷 preview/进度。首行「可能活跃」成立恰因那条链被 daemon 自己 resume 过（persistence 已跟到新文件）。

**修复方向（卡内定）**：watcher 观察时顺链**正向迁移**——检测同目录新出现且 parentSession 指向被观察文件的 transcript，attach 跟到新文件（含 sweep 的 stat 目标更新+ownership 基线重定）；或 attach 时即解析链尾（resolveOmpResumeAncestorPaths 已有走链能力，反向复用找最新叶子）。回归=导入屏该行为「外部·运行中」+对话列表 pill 翻外部+preview 实时推进；生产数据实测。
**关联**：与 F24（计数口径）、F25（缓存回跳）同属所有权/导入数据面，建议同车。

## 收卡裁定（编排者，2026-10-02）

- **B8-IMPORT KI#2 provider 图标退场**：接受（对齐会话行=用户明令；会话行亦无 provider glyph）。若日后要可见性，色块角标另卡再拍。
- **B8-IMPORT KI#1 Windows 反斜杠/盘符大小写 cwd 匹配缺口**：并入 B8-COUNT（同文件域 import-sessions.ts），服务端出口做归一。
- **B8-IMPORT 残留归档会话**：两 home 均查无此记录（grep echo hi 仅命中 09-30 旧 C11 记录；今日 archivedAt 零命中）→ 归档点击与取消归档点击同属未落，无残留需清。手机 UI 若见则手动解。
- **B8-CACHE KI: preview 键未进缓存白名单**：冷缓存回水化预览行短暂空、重取即愈=瞬态，记 KI-10 缓办不立案。

## F29 文件页三页签并入横滑逻辑（2026-10-02，用户追加）

- 口径：**文件页面的三个页签**（现场核实具体成员）之间也可用手指左右滑切换，**带跟手动画**，姿势与 B8-SWIPE 环一致（同一状态机/手势底座，勿另起炉灶）。
- **拍板（D6，编排者裁定）**：内部三段**线性非循环**跟手滑（同环阈值/动画参数）；**边界级联**——最左「文件」再右滑外抛（栈页=返回；工作区 tab=主环接管），最右「提交」再左滑外抛（工作区 tab=主环接管）；段内横向可滚内容声明豁免同前。非 git checkout 两段灰=无内滑只剩外抛。卡=B8-FILESWIP。
- **用户追加确认（原话要义）**：「文件页签不用循环——手指向右滑在最左页签=返回，而不是回到最后一个页签」→ 已转 F5 钉死为必红断言（first+right→cascade，永不 wrap）。

## 终态门禁（编排者亲跑，HEAD=a025fb0de 时点，F5 在途除外）

- app：3 文件/4 例失败 = `time.test.ts` locale×3 + `parse-changelog` tz×1 + `git/forges/index` 收集错×1 —— **全⊆W1 环境基线**。
- protocol：1 例失败 `messages.providers-snapshot`「bodyless」= 本机 AOT 动态 import 5.6s>5s 默认超时；**判决实验：回退 pre-COUNT messages.ts 重生成仍红、--testTimeout=30000 全绿** ⇒ 既存负载敏感项非批次八回归。
- server：1 例失败 `execution-session.websocket` = `EBUSY rmdir` 临时目录（W1 在案 Windows 环境类）。
- typecheck 全 workspace 绿（每提交 pre-commit + 门禁时点复跑）。
- 坑账：门禁首跑用 `cd /c/...` 小写盘符 → vitest 双实例 695 文件假红（bg_1 作废）；大写 `C:/` 重跑为准。**BUILD.md #8 已有同纪律，本次=踩坑复证**（教训：门禁命令模板应强制大写 cwd）。
