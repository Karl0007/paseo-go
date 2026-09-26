# NEXT 批次 — 需求收集记录（**已冻结** 2026-09-27，转 DESIGN §14 + 正式卡）

> 状态：**已冻结**。用户四项终裁（2026-09-27）：
> ① **Q1 语音**：只做配置落地+部署规格交付；端到端真机验证**挂起待用户部署端点**（known_issue 入卡）。
> ② **Q10**：设计卡出稿后按编排者推荐直接拆实现卡落地，设计文档留档事后审。
> ③ **批次终态**：重打 release APK **v0.2.0**（debug keystore）+ 总验收对照表。
> ④ **设备**：MatePad 全程在线（充电+不锁屏+adb 可达），真机验证不降级。
> 执行序=本文件末「汇总队列」表；实现口径以各正式卡为准，本文件保留需求原话与取证。
> 口径基线：DESIGN.md（冻结真相+§14 增补）+ ACCEPTANCE.md（v0.1.0 台账）+ 当前 HEAD 代码事实。

## 记录格式（每条）

- **原话**：用户表述（尽量逐字）
- **理解**：我的复述/边界，待用户确认
- **相关事实**：涉及的文件/既有设施/与冻结文档的关系（冲突需裁定）
- **裁定**：用户拍板结论（当场落盘；未定标 ⏳）
- **去处**：新卡 / 改既有卡 / known_issue / 不做

---

## Q1 语音输入用不了（toast: Voice features are unavailable: model download failed (fetch failed)）

- **原话**：「语音输入用不了」+ 截图 toast `Voice features are unavailable: model download failed (fetch failed).`
- **理解**：用户在连接 LAPTOP-K7UNLBKK（本机）的 app 上点语音输入被 toast 挡回；要的是语音输入可用。
- **相关事实**（已取证，均代码/磁盘实况）：
  1. toast 文案出自 **daemon 侧** `packages/server/src/server/speech/speech-runtime.ts:259`
     （`reasonCode: model_download_failed`，`retryable: false`）；app 只是透传 daemon 语音就绪态。非壳缺陷，语音链路=官方功能。
  2. 模型下载源=GitHub release（`model-catalog.ts`：parakeet STT + kokoro TTS，
     `k2-fsa/sherpa-onnx` tar.bz2）；`model-downloader.ts:49` 用原生 fetch，**不读任何代理环境变量**。
  3. 失败后**无自动重试**：`speech-runtime.ts` monitor tick 仅在 `!backgroundDownloadError` 时才重新
     `startBackgroundDownload`；错误态冻结直到 daemon 重启。UI 无重试入口。
  4. 磁盘实况（用户真 daemon `~/.paseo/models/local-speech/`）：`.downloads/` 里
     **kokoro(319.6MB) 与 parakeet(482.5MB) 两个完整归档都在**（Sep 25 07:13/07:35），另有 92MB `.tmp` 残片
     （下载中途进程死痕迹）；解压目录不存在。下载器逻辑=归档存在且非空则**跳过 fetch 直接解压**
     → 下次 daemon 重启触发下载时会直接进解压阶段，"fetch failed" 是冻结的旧错误态。
     dev daemon（`.dev/paseo-home`）models 目录不存在=从未发起下载。
  5. 语言硬事实：目录内 STT 只有 parakeet v2（English）/ v3（25 欧洲语言），**无中文模型**；
     TTS kokoro-en=英文。即使下载修复，中文口述也无法识别。
- **待用户裁定**（⏳）：
  - a. 截图连的是哪台 daemon：真 daemon(~/.paseo, 6767) 还是 dev(6767/.dev home)？
  - b. 期望语言：中文口述是硬需求？（若是 → 官方目录无中文模型，需扩目录/换引擎，量级完全不同）
  - c. 修复范围是否解禁 `packages/server`（"packages/\*\* 冻结"是壳 fork 期铁律；本问题的根因全在官方 daemon 侧）
  - d. 本机是否有可用 HTTP 代理（决定"代理支持"是否值得做）
- **候选方向**（未拍板，仅备选项）：
  ① 立即解锁：重启真 daemon（归档已在盘上→直接解压，零改动验证链路通不通）
  ② daemon：下载失败可重试（清错误态/UI 重试入口）+ 尊重 HTTPS_PROXY/镜像源 env
  ③ 中文 STT：扩模型目录（如 sherpa-onnx 的中文 zipformer/paraformer）+ 语言配置——大工程
  ④ 壳侧仅提示优化（不动官方）——治标
- **追问：自部署模型能否接入？**（已取证，答案=能，OpenAI 兼容 provider 官方现成）
  1. provider 按功能三选：`PASEO_DICTATION_STT_PROVIDER` / `PASEO_VOICE_STT_PROVIDER` /
     `PASEO_VOICE_TTS_PROVIDER` = `openai`|`local`（默认 local；也可写持久化 config
     `features.dictation.stt.provider` 等）。
  2. OpenAI 兼容面（`providers/openai/config.ts` + `stt.ts`）：
     - `OPENAI_STT_BASE_URL`（或 `OPENAI_BASE_URL`/持久化 `providers.openai.stt.baseUrl`）=**任意 base URL**
     - `OPENAI_STT_API_KEY`（或 `OPENAI_API_KEY`）——**必须非空**（无 key 则 openai 配置整体不解析；
       自部署无鉴权也要塞 dummy）
     - STT 模型名=**任意字符串**（`STT_MODEL` env / 持久化 `features.*.stt.model`）
     - 调用形态：OpenAI SDK → `POST {base}/audio/transcriptions`（multipart WAV 分段，非流式 WS）
       → whisper.cpp server / faster-whisper API / Speaches / Xinference / GPUStack / vLLM-audio 等
       兼容面均可；**whisper large-v3 / SenseVoice 类中文模型顺带解决"无中文 STT"问题**
  3. 约束：TTS 面 model 枚举钉死 `tts-1|tts-1-hd`、voice 枚举 6 值（服务端需按这些名字接单）；
     `PASEO_DICTATION_ENABLED`/`PASEO_VOICE_MODE_ENABLED` 总开关；env 需进 daemon 进程——
     真 daemon 的 env 注入方式（或改写持久化 config 文件）是落地时要定的实操点。
- **裁定（用户，2026-09-26）**：方案由编排者全权评估拍板；交付物=给用户一份「需要部署的接口规格」。
  约束：**不写临时代码、不重复造轮子、选改动冲突风险小的正式方案**（优先官方现成机制=纯配置；
  若需代码，须上游风格的最小正式改动）。实现细节不再询问用户。
- **方向（编排者评估，冻结前定稿）**：语音 provider 切 `openai` 兼容面（官方现成，纯配置），
  用户自部署 OpenAI 兼容 `/audio/transcriptions` 端点（含中文模型）；local 模型下载路径整体绕开
  （"fetch failed 冻结态/无代理/无中文"三问题同灭）。落地细节（部署哪个 server、持久化 config
  写法、logprob/置信度兼容性核实）在冻结文档定稿。
- **去处**：⏳ 冻结后立正式卡（配置落地 + 部署规格交付）

---

## Q2 导入会话屏：无搜索 / 无父子关系 / 无状态 + 导入后同步语义

- **原话**：「导入会话没有搜索功能，而且没有区分父子会话关系，而且看不到会话状态。你需要额外考虑的情况是，我如果导入了一个电脑端正在运行的会话，这个会话不是通过 paseo 启动的，那我能不能在导入之后持续的同步到会话的数据，还是会分叉？」+ 壳导入屏截图（omp 会话平铺列表）。
- **理解**：四个子问题 Q2-a 搜索、Q2-b 父子关系、Q2-c 状态、Q2-d 导入后同步/分叉语义。
- **相关事实**（已取证）：
  - **Q2-a**：daemon RPC `fetch_recent_provider_sessions_request` **已支持 `query`**
    （protocol/messages.ts:1332-1340；provider 侧检索，扫描窗 500，server/agent/import-sessions.ts）；
    官方桌面 `import-session-sheet.tsx` 已实现搜索（debounce + `useHostFeature(serverId,"importSessionSearch")`
    capability gate）。壳 C10 屏 `use-import-list.ts` 只传 `{limit}`——**纯壳侧漏配**，非协议缺口。
  - **Q2-b**：descriptor 协议字段=providerId/Label/HandleId/cwd/title/first+lastPromptPreview/
    lastActivityAt（messages.ts:867-877）——**无 parent 字段**。omp 列表是递归文件扫（父会话与
    子代理会话混排平铺，omp/session-descriptor.ts 注释明说 nested completed-subagent transcripts
    保持 importable）。omp session 文件头 `{type:"session", id, parentId}` 携带跨会话父链 →
    补协议 optional 字段（parentHandleId/parentTitle 类）+ omp 头部解析即可，协议契约允许纯增。
  - **Q2-c**：descriptor 无 status；daemon 对外部会话**无存活探测**（全仓 watcher 只覆盖
    file-explorer；无进程探活）。外部会话=磁盘 jsonl，可靠"运行中"信号不存在；
    可做的正式形态=mtime 启发式（如 `looksActive`，近 N 分钟有追加）+ 已有 lastActivityAt 展示。
  - **Q2-d 同步语义**（直接回答用户问题）：
    1. **导入=引用+快照，不是数据克隆**：paseo agent 记录持 provider persistence handle
       （omp/pi=会话文件路径；claude/codex=会话 id），时间线 import 时从源文件 re-stream 进 paseo 存储。
    2. **持续同步=没有（拉式）**：无文件 watcher；外部新内容只在 `refresh_agent_request`
       （官方 "Reload agent"：rehydrateFromDisk → 清时间线 → 重新流式导入源历史）时进入。
       官方桌面 tab 菜单有入口；**壳侧无**（长按五动作没有刷新）→ 壳需加"刷新"动作（调现成 RPC）。
    3. **分叉风险真实存在，形态 per-provider**：从 app 给导入 agent 发消息=paseo 起新 provider
       进程 resume 同一会话。omp/pi=同文件续写：桌面端进程若还活着=双写同文件→分支分叉；
       桌面端已关=安全续写。claude/codex=resume 可能换 handle（新 session/thread id）→
       桌面端原会话看不到 app 侧新轮次=**静默分叉**[INFERENCE，落地前逐 provider 实测钉死]。
    4. 正式护栏=发送前检测源近期活跃（mtime 启发式）→ 警示「源会话可能正在电脑上运行，继续将分叉」；
       只读+刷新路径不分叉。
- **方向（编排者裁定，冻结定稿）**：
  - Q2-a：壳侧移植官方搜索姿势（debounce+query 透传+capability gate；旧 daemon 降级=客户端过滤
    当前列表）——小卡，零上游改动。
  - Q2-b：协议 optional 字段 + omp provider 解析 + 壳侧分组/徽标——中卡，上游触点=protocol+omp
    （正式增补，COMPAT 规则内；claude/codex 无父链概念则字段缺席）。
  - Q2-c：明示限制（外部会话无可靠存活信号）；mtime 启发式「可能活跃」徽标 + 时间展示——小卡。
  - Q2-d：壳导入屏/会话屏加「刷新（从源重新同步）」动作 + 分叉警示——中小卡；per-provider resume
    语义实测报告随卡交付。
- **去处**：⏳ 冻结后拆 4 卡（a/d 纯壳优先，b/c 涉上游=正式最小改动）

---

## Q3 菜单形态：底部弹层 → 触发点旁锚定小弹窗

- **原话**：「现在的加号，长按之类的逻辑都会在屏幕下方弹窗。但是通常的软件设计是在你点击的区域旁边弹出一个小的弹窗。」+ 壳对话 tab「新建」底部 sheet 截图。
- **理解**：壳内所有菜单（＋菜单、主机胶囊、行长按、⋯、收藏/指令长按、文件溢出菜单、胶囊菜单）从底部 sheet 改为锚定在触发点附近的 popover 小弹窗。
- **相关事实**（已取证）：
  1. 壳菜单**全部已骑官方菜单引擎**（`components/ui/menu/`，dropdown-menu/context-menu 包装）——
     但显式选了 sheet 形态：chats-header `DropdownMenu compactMode="sheet"`（注释：sheet 是当时
     选的 compact 形态）；`ContextMenu` 引擎默认 compact=sheet（docs/menus.md）。
  2. **官方引擎原生支持 compact popover**：`compactMode` 默认即 `"popover"`（锚定触发器，
     宽屏/窄屏同引擎；docs/menus.md 两形态表）；锚定/翻转/边缘钳制在 `menu-anchor.ts` 有单测；
     compact popover 行高按拇指设计（<md 断点 40pt）。**不是能力缺失，是壳选型偏保守**。
  3. 约束/坑：含输入框的菜单页**必须是 sheet**（MenuTextField 依赖 sheet context，docs/menus.md）——
     壳的 rename 走独立屏不受影响；Android 浮层 Portal/Modal 坑面在 docs/floating-panels.md
     （C14 实测过 Modal 覆盖屏不挂载——菜单引擎自带 overlay 层，需真机验证 compact popover 在
     壳屏上的实际表现，可能是**官方引擎在手机上首个 popover 重度使用**，坑要实测踩）。
  4. 行长按与拖拽仲裁（useShellRowDragMenu 锚在触点）与 popover 兼容：popover 锚 trigger 矩形。
- **方向（编排者裁定，冻结定稿）**：壳侧逐菜单 `compactMode` sheet→popover 切换（引擎现成能力，
  零新轮子）；清单=chats 头部＋/主机胶囊/行长按+⋯/工作区收藏+指令长按/文件预览溢出/收藏行/
  C14 胶囊菜单；真机逐屏验证锚定、翻转、钳制、与拖拽共存、Android 浮层无白闪；发现引擎级缺陷
  按最小正式改动修上游（menu-anchor/AnchoredSurface），随卡报告。**纯壳卡**（上游仅可能带引擎修复）。
- **去处**：⏳ 冻结后立卡（一张：菜单形态切换+真机矩阵）

---

## Q4 对话行状态显示混乱：双点并存 + 未读被每步活动触发

- **原话**：「你会发现这里的状态显示是有点混乱的，又有一个绿色的小点，又有一个蓝色的小点。而且未读状态不是，在一个任务完全执行完之后才出现。还是好像任何一个步骤都能触发这个未读状态。」+ 运行中会话行截图（绿呼吸点+蓝点并存，副标题"运行中"）。
- **理解**：①状态灯与未读点两个圆点同屏视觉混乱；②未读语义错误——期望"任务完结/需要你处理"才算未读，现状是任何中间步骤都翻未读。
- **相关事实**（已取证）：
  1. 两点来源明确：绿点=`ChatStatusLight`（官方 AgentStatusDot，四态灯，running=呼吸）；
     蓝点=`UnreadBadge`（title 行 accent 圆点；等待批准时=计数 pill）。二者独立渲染，
     运行中+未读必然双点并存（chat-list-row.tsx:226-234）。
  2. 未读判定=`isChatUnread: max(lastActivityAt, attentionTimestamp) > lastReadAt`（chats/derive.ts）。
     `lastActivityAt`=目录任意活动戳——**运行中每个步骤都推进它**；用户离开会话后（返回拍已按
     当时 max 打水位），任何中间活动即翻未读 → 用户观察属实，**语义缺陷成立**。
  3. 现成的正确信号：`attentionTimestamp`/`attentionReason`（finished/error/permission）——
     **每次 turn 完结/需处理才推进**，通知管线（attention.ts）已在用它做跃变去重，域一致。
- **方向（编排者裁定，冻结定稿）**：
  1. **未读语义改「完结制」**：`isChatUnread = attentionTimestamp > lastReadAt`（水位照 F4 host 域；
     打水位仍可用 max——完结后 attention==max，运行中 activity 涨 attention 不涨 → 不翻未读）。
     无 attention 事件的会话（如刚导入的历史会话）=不判未读，符合直觉。derive.test+open-agent.test 同步。
  2. **双点收敛为单指示**：状态灯处于活跃态（running/needs_input/failed）时**不渲染蓝点**
     （未读靠标题加粗表达）；灯为灰（done/idle）时蓝点=「完成且未看」的唯一圆点信号。
     计数 pill（等待批准数）保留——它是数字徽标不是圆点，不与灯混淆。
  3. 纯壳改动（derive/chat-list-row/open-agent + 测试），零上游触点。
- **去处**：⏳ 冻结后立卡（与 Q2-c 状态徽标同域，可并卡或前后卡）

---

## Q5 长按仲裁重定义：长按出指尖小窗 → 窗开时滑动 = 关窗转拖拽排序

- **原话**：「关于这个列表的长按逻辑，我觉得现在有点混乱，理论上来说应该是长按之后弹出一个手指旁边的小窗，这是我刚才提的一个问题。然后长按的时候如果滑动，那就这个小窗消失，然后改为修改排序。」
- **理解**：手势状态机改为：长按停留 → 锚定指尖旁的小窗（=Q3 popover）；**小窗打开后手指滑动 → 小窗消失、同一手势无缝转为拖拽换位**。是 Q3 的深化（Q3 管"窗在哪"，本卡管"窗与拖拽的接力"）。
- **相关事实**（已取证）：
  1. 置顶行现有仲裁 hook（use-shell-row-drag-menu）：180ms 停留=arm 拖拽；500ms 停留=菜单
     **已锚触点弹出**（setAnchorRect 触点矩形）；**但 `menuOpenedRef=true` 后 handleTouchMove
     直接 return——窗开后的滑动是死区**，既无关窗也无关拖拽。用户要的"窗→滑→拖"接力不存在。
  2. 非置顶行走引擎原生长按（无 hook），根本不能拖；"排序"当前只在置顶组内。
  3. hook 头注释已证：官方上游 hook 在 arm 定时器里调 drag() 会掐断 JS 触摸流（MatePad 实测
     菜单打不开）；本 hook 的"移动时才 drag()"是 DraggableFlatList 文档姿势，接力改动有基础。
- **方向（编排者裁定，冻结定稿）**：
  1. 状态机加一条边：`menu_open + 移动超阈值(≈10px) → setOpen(false) + drag()`（arm 早已就绪），
     触觉反馈一次；窗关与拖起在同一触摸流内完成，不得出现"要重新长按"的断点。
  2. **全部行**（不只置顶）接入该 hook（非置顶行禁引擎原生 mobile 触发，官方引擎支持
     "disable mobile triggering on draggable rows"）——用户表述无条件，滑动=排序意图对任何行成立。
  3. 语义裁定：非置顶行拖拽落位=**置顶并插入落点**（drag=排序意图，落哪挂哪）；置顶行=组内换位
     （既有 reorderPinned）；落点越界钳制在置顶组内（既有行为不变）。
  4. 与 Q3 强耦合：**依赖 Q3 先落**（popover 形态下关窗快、无 sheet 退场动画吞触摸；若 sheet 形态
     做接力，Modal 退场与拖拽手势打架——这正是本卡要消灭的"混乱"来源）。
  5. 真机矩阵：置顶行窗→滑→拖全链、非置顶行同链、慢速注入 ≥50px/s 纪律（BUILD.md）、
     与下拉刷新共存、窗开时轻点选择动作不受影响。
- **去处**：⏳ 冻结后立卡，排在 Q3 之后（同文件域 use-shell-row-drag-menu/chat-list-row，串行）

---

## Q6 ＋→新建对话 应直达官方「新建 workspace」composer 屏

- **原话**：「点了加号新建会话之后。我其实希望弹出的是这个界面。」+ 截图（"新建 workspace" 屏：
  work 项目 ▾ / LAPTOP-K7UNLBKK ▾ / Chat ▾ 三选择器 + 底部 composer「发消息，@files，/commands」+ 模型选择）。
- **理解**：＋菜单「新建对话」现在打开的是官方 **add-project 流程**（选项目/建工作区的过渡流程，
  chats.tsx:384 `useOpenAddProject()`）；期望**直达截图屏**=官方 `/new` 路由
  （`app/new.tsx` → NewWorkspaceScreen，屏内自带项目/主机/模式三选择器与 composer，
  参数 serverId 必填 + dir/name/projectId/draftId 可选）。
- **相关事实**：
  1. `/new` 是根级路由，`HostRouteBootstrapBoundary` 包裹——与壳已验证可 push 的 `h/` 会话路由同族
     （SPIKE A2/C4 姿势），从 (shell) push 无障碍。
  2. 屏内主机选择器可切 host → 传哪个 serverId 只是初始值：取"当前在线主机"里第一个
     （与对话 tab 主机胶囊语义一致），离线屏自会呈现状态。
  3. add-project 流程**保留**给工作区 tab 的「＋新建项目」（那是项目/checkout 语义，不同用途）。
- **方向（编排者裁定，冻结定稿）**：纯壳小卡——`handleNewChat` 从 `openAddProject()` 改为
  push `/new`（serverId=首选在线主机）；路由串进 `routes.ts`（`OFFICIAL.newWorkspace(serverId)`）；
  空态「新建对话」按钮同改；routes.test + 真机验证（push/返回/无主机边界/屏内切 host 后发起会话）。
- **去处**：⏳ 冻结后立卡（小，纯壳）

---

## Q7 会话屏顶栏：胶囊上位移交官方顶栏 + 左滑返回 + ⋯ 聚合官方右侧动作

- **原话**：「这是现在实际的对话画面。我希望下面那一串带返回带三个点的是顶部的区域。能够真正的替换掉它原生的这个顶部逻辑。同时向左滑动，应该回到上一页的对话列表（和返回键一致）。右侧的三个点里面集成现有的右侧区域逻辑，包括查看文件，查看diff，运行xxx之类的。你能理解我的需求吗」+ 截图（顶部官方 header ≡/标题/⋯/▷/面板开关 与底部壳胶囊 ‹/标题/灯/⋯ 并存）。
- **理解**：对 C14 胶囊的升级裁定（推翻 C14"底部共存"分支）：①胶囊移到**顶部**，视觉与功能上**替换**官方 compact header；②向左滑动=返回对话列表（与返回键一致）；③胶囊 ⋯ 吸收官方右侧簇动作（⋯ 工作区菜单、▷ 运行脚本、面板开关→查看文件/查看 diff）+ 既有（查看项目文件/停止/重命名）。
- **补充裁定（用户，2026-09-27）**：官方会话屏**左右边缘滑动确实会拉出原生文件面板/列表**（勘误：此前
  "横向手势面空闲"判断错误）；裁定=**文件功能移入胶囊 ⋯**；**左滑（拉出左侧面板的手势，手指向右）
  改为返回对话列表**（与返回键一致）。
- **相关事实**（已取证）：
  1. 官方 compact 边缘手势系统（`src/mobile-panels/gestures.ts` + provider）：左缘 Pan=拉出
     agent 列表（根 `MobileGestureWrapper` 挂载，chromeEnabled=在 h/ 工作区路由恒真，壳会话屏同样生效）；
     右缘 Pan=拉出文件 explorer（`CompactExplorerSidebarHost`）。**provider 暴露正式阻塞 API
     `setOpenGestureBlocked(symbol, true)`**（symbol-keyed blocker 集合，官方给浮层场景用的正道）——
     壳可在会话屏聚焦时注册 blocker 停掉两侧 open 手势，再装自己的左缘 Pan→`router.back()`。
  2. 官方 compact header 右侧簇（workspace-screen.tsx:1019-1040, 3788-3803）：
     `WorkspaceHeaderMenuMobile`（⋯ 工作区动作）、`WorkspaceScriptsButton`（▷ 运行脚本）、
     `WorkspaceExplorerToggle`（文件面板开关）。会话/diff/文件在移动端=**工作区 tabs**
     （agent/changes/files/pullRequest），tab 切换器=下拉非分页 → 面板内容区横向无主，
     边缘手势让位后仅剩纵向滚动，无残留冲突。
  3. C14 胶囊现挂根 floating-panels Portal 浮层、底部放置、纯谓词可见性（shellMode+壳来源栈）——
     上移=改锚定与样式，机制不变；官方 header 占布局位，胶囊全宽不透明覆盖（含状态栏 inset）即视觉替换。
- **方向（编排者裁定，冻结定稿）**：
  1. 胶囊上移顶部全宽覆盖官方 header（同 Portal 机制）；官方 header 控件不可达=预期行为，
     其能力全部并入胶囊 ⋯（复用官方动作层/同一 store action，不重实现）：
     **查看项目文件**（既有 C16 detail 路由）· **查看 diff**（切 changes tab）· **查看文件**
     （切 files tab / 等价 explorer toggle）· **运行脚本**（scripts 子页，数据源=workspace descriptor）·
     **停止** · **重命名** ·（⋯ 官方菜单其余动作按"常用上提、其余子页"取舍，卡内定清单）。
  2. 边缘手势改道（纯壳）：壳会话屏聚焦期间 `setOpenGestureBlocked` 注册 blocker（卸载时释放）；
     壳装左缘透明 Pan 带（宽≈官方 32px 语义，方向锁+阈值）→ `router.back()` 回对话列表；
     右缘手势直接废（功能进 ⋯）。返回键/系统边缘返回并存不变。
  3. 汉堡抽屉在壳 IA 无对应物，替换后不可达=预期（记入卡内 known 决策）。
  4. 依赖：Q3（⋯ 用 popover 形态）先落；visibility 谓词/单测保留，菜单矩阵扩展 session-header
     visibility.test + 真机矩阵（覆盖高度/状态栏 inset/暗色/返回/三动作实跑/左滑返回/
     blocker 释放后官方手势在官方 IA 下不受影响——**壳外零行为变化**）。
  5. 纯壳改动（胶囊组件+菜单矩阵+手势+blocker 接线）；官方零触点。
- **去处**：⏳ 冻结后立卡（中大卡，排 Q3 后；与 Q5 同文件域串行）

---

## Q8 工作区 tab 重构（项目行+展开会话）+ 文件屏（头部/搜索/diff/git 页签）

- **原话**：「工作区这块有几个问题。第一个右侧的这个正在运行的 agent 计数很容易产生困惑……首先对于每一个项目，它可以塑形展开。下面挂着的所有的会话，但是它会默认收起。左侧有一个小箭头，可以选择展开还是收起，Agent 的运行信息作为这个小箭头的角标。如果直接点击这一行，就还是进入文件页面。文件页面……最上面那一条记录了主机名和项目路径还有项目的标题……那一行没有什么意义，只需要保留那个项目路径……整个的主标题/主视觉应该是那个工程的名字，而不是一大段的描述（取了什么摘要，逻辑上不太对）。除此之外文件页里面也没有搜索功能，需要加一个搜索。另外我还希望在这个文件页里面能够有两个页签，一个是 diff 一个是看到 git 的记录。」+ 工作区 tab 截图 + 文件屏截图。
- **理解**（四组）：
  1. **行结构**：行=项目（主视觉=工程名，现在的主标题是 daemon 自动生成的任务摘要
     `workspace.title`（derive.ts:124），projectName 本来就只在副标题）；左侧 chevron 展开/收起
     （默认收起），展开=该项目全部会话（点会话行进官方会话屏，复用 C4 opener）；
     **agent 运行信息改为 chevron 角标**（现右侧独立绿圈计数=困惑源，废除）；点行体=进文件页。
  2. **文件屏头部**：现=返回 + `host › project › workspace` 面包屑（files-screen-body.tsx:101-131）
     → 只保留**项目路径**；主标题语义=工程名。
  3. **文件屏搜索**：页内加文件名搜索。约束（C9 已探死）：协议无文件名搜索 RPC，
     正式口径=已浏览目录的客户端过滤（复用 `shell/search/file-search` 纯函数），空态如实说明范围。
  4. **文件屏两页签**：`文件 | diff | git 记录` 三段。官方组件现成可复用：
     `git/diff-pane.tsx`（DiffPane+changed-files-tree）、`git/commits-section/commits-section.tsx`
     （`CommitsSection{serverId,cwd,onCommitPress}`，checkout 提交史，含骨架/错误态）。
- **结构裁定 v2（用户，2026-09-27，覆盖编排者"合并 worktree"提案）**：数据模型与展示层级对齐——
  **L1 工程（仓库文件夹）→ L2 worktree → L3 session**（一个 session 挂一个 worktree，一个 worktree
  多个 session；与官方 project→workspace→agent 模型逐层同构）。
  - **对话 tab（第一页）= 每个 session 平铺**（现状语义不变）。
  - **工作区 tab（第二页）= 三层树**：L1 项目行（主视觉=工程名；chevron 展开 L2；chevron 角标=
    旗下 worktree 聚合运行信息）→ L2 worktree 行（worktree 名+路径尾段；chevron 展开 L3；角标=
    本 worktree 活跃数；**行体点击=该 worktree 的文件页**——文件入口按 worktree 走，
    编排者此前的"最近活跃工作区"折中作废）→ L3 session 行（provider 图标+标题+状态灯；
    点击=官方会话屏，复用 C4 opener）。默认全部收起；点 L1 行体=展开/收起（其下有意义的单位是 L2）。
- **相关事实**：
  - 底层逐层同构：`ProjectSummary.hosts[].workspaces[]`（derive.ts:110-115）；agent 带 workspaceId；
    worktree 名=workspace.title/name（现 L1 误用的"长摘要"实为 **worktree 级**标题，降到 L2 即归位）。
  - `ShellWorkspaceRow` 已含 projectName/activeCount/lastUsedAt（derive.ts:30-35）；
    聚合 agents 已带 workspaceId → 按项目挂会话是纯派生，无新 RPC。
  - 角标语义沿用 `isWorkspaceAgentActive`（running/initializing/permission-waiting），
    呈现改为 chevron 上的徽标（活跃数+状态色，needs_input 优先着色）。
  - 展开态=壳本地 UI 态（不入 persist store，会话级记忆即可；裁定：不跨启动保持）。
  - **同一 worktree 被拆行（用户确认的现象，已实锤）**：dev home 磁盘实测
    `C:\work\paseo-go` 同一目录+同分支挂着 **17 条活跃 workspace 记录**（wks\_\*，displayName 混杂
    "main"/"paseo-go"）。根因=上游**有意设计**：`create-agent/create.ts:47` 注释
    "Mints a fresh directory workspace for a cwd"——经 agent/MCP 路径每次建会话都 mint 新记录；
    壳 derive 现只按 `workspace.id` 去重，同目录多记录=多行。
  - **展示层解法（并入 Q8 卡①）**：L2 worktree 行按**物理身份（cwd 规范化+分支）合并**——
    同目录多记录并成一行，旗下 session 全挂上；L2 行体点文件页取代表记录（最近更新）。
    数据层重复记录**不动**（上游设计，越权清理=分叉风险）；另立 investigation 卡核实
    上游新版本是否已有同 cwd 复用/自动归档机制（若有则壳合并逻辑与之兼容）。
  - **设计动机（public-docs/workspaces.md 原文口径）**："Paseo is organized around workspaces,
    not chats"——workspace=任务容器（独立标题/标签页/diff 上下文/服务路由/归档生命周期，
    auto-archive-on-merge 按容器归档）；"More than one workspace can refer to the same managed
    worktree"（同目录多记录=合法，worktree 按最后引用归档）；"A bare `paseo run` … creates a new
    local workspace; pass a workspace ID when you want an agent in a specific existing workspace"
    ——**复用正道=显式传 workspaceId**。壳按物理身份合并 L2 与官方"多容器引用同一 worktree"语义同构。
- **方向（编排者裁定，冻结定稿）**：壳侧两卡——
  ①工作区 tab 树重构（derive.ts 改项目分组 + 行组件 chevron/角标/展开会话 + 测试 + 真机）；
  ②文件屏改造（头部只留路径 + 页内搜索（复用 file-search 纯函数）+ 三段页签嵌官方
  DiffPane/CommitsSection + 测试 + 真机）。均纯壳，零上游触点。
- **去处**：⏳ 冻结后立 2 卡（②依赖①的行语义；与 Q6/Q7 的 routes/胶囊域有交叠处按卡序串行）
- **补充裁定（用户，2026-09-27）**：三层树改后，各层行的长按/其余交互**由编排者侧自行设计补全**。
  基线：L3 session 行沿用 C3 五动作菜单与语义（置顶/重命名/归档/停止/删除，复用 shellAgentActions）；
  L1 项目行、L2 worktree 行的菜单内容与展开交互在卡内设计定稿（设计+实现+验证可全交子 Agent）。

---

## Q9 能否区分 paseo 原生 session vs 主机原有（导入）session

- **原话**：「现在对于每一个 session 来说，能够区分他是 paseo 的原生 session，还是一个主机上原有的 session 吗？」
- **结论（已取证）**：**现在不能**——数据层无出处标记。`StoredAgentRecord`（agent-storage.ts:49-78）
  无 import 字段；`importProviderSessionInternal`（agent-manager.ts:1419-1482）注册路径与原生
  createAgent **完全同构**（`reason:"import"` 只进 launch context，不落盘）；labels 注册表
  （protocol/agent-labels.ts）只有 parent-agent-id / open-agent-tab 两族键。
- **但官方扩展点现成**：`import_agent_request.labels` → `StoredAgentRecord.labels` →
  `AgentSnapshotPayload.labels`（messages.ts:832）全链已通——labels 就是为此设计的元数据机制。
- **方向（编排者裁定，冻结定稿）**：正式最小上游改动=在 `importProviderSessionInternal`
  （**唯一 import 咽喉点**）落盘时盖 `paseo.imported` label（+agent-labels.ts 导出常量；
  协议零变更，labels 是既有 record 字段）——所有客户端（官方桌面+壳）一致受益，非壳私有 hack。
  壳侧消费：①导入会话行加「导入」徽标；②Q2-d 的「刷新/分叉警示」语义只对带 label 的会话生效
  （原生会话无外部源，不该出现刷新入口）；③Q2-b 父链展示可同批评估。**存量已导入会话无 label=
  不可区分**（如实记录，不做启发式冒充）。上游触点=2 文件各 1-2 行，COMPAT 规则内。
- **去处**：⏳ 冻结后立卡（与 Q2-a/d 同域，宜先于 Q2-d 落——它是分叉警示的判定依据）

---

## Q10 横屏平板结构优化（参考平板微信/QQ/飞书 IM 双栏）

- **原话**：「对于一个横屏使用的平板来说，我希望它的结构能够优化一下，特别是会话页面，你可以参考一下平板的微信，QQ 或者飞书这些软件，他们的聊天是怎么做的。你可以先自行出一版设计。」+「不一定要现在设计完，设计/实现/验证都可以交给子 Agent，你了解概况和目标即可。」
- **目标（一句话）**：横屏（宽屏断点）下，壳的竖屏三 tab IA 升级为平板 IM 范式——导航轨 + 列表栏 + 详情栏 master-detail，会话不再全屏 push。
- **相关事实**（已钉，够卡内展开）：
  - 宽屏判定=Unistyles breakpoint（`useIsCompactFormFactor`：xs/sm 为 compact；layout.ts:42-45）；
    MatePad 横屏落宽屏 → 官方根布局会挂 desktop 风格 LeftSidebar（\_layout.tsx:540-555）——
    现状=壳底部 tabs + 全屏 push + 官方侧栏并存，即"结构乱"的来源。
  - 官方宽屏设施可参考/复用：SplitContainer、floating-panels、mobile-panels；官方 web/desktop
    本身就是 master-detail。
  - 真难点（设计卡核心议题）：官方会话屏=路由级组件，"渲染进右栏"要么动根布局
    （**新上游触点，需走 DESIGN §2 增补裁定流程**），要么保守方案（宽屏仅列表栏化、push 保持全屏）。
    方案取舍=设计卡交付物。
- **流程裁定（编排者）**：立**设计卡先行**（子 Agent 出设计稿：断点行为、三栏结构、各 tab 宽屏形态、
  路由实现选项与上游触点预算、微信/飞书范式对齐点）→ 用户过目拍板 → 再拆实现卡。设计卡不改代码。
- **去处**：⏳ 设计卡 1 张（产出=设计文档进 paseo-go/，裁定后并入冻结文档）

---

## 汇总队列（对齐后转正式卡）

> 建议执行序（依赖+文件域驱动；同域串行，跨域可并行批次见冻结文档）。

| 序  | 主题                                        | 域                   | 上游触点      | 依赖      |
| --- | ------------------------------------------- | -------------------- | ------------- | --------- |
| 1   | Q6 新建对话直达 /new                        | 壳                   | 无            | —         |
| 2   | Q4 未读完结制 + 双点收敛                    | 壳                   | 无            | —         |
| 3   | Q3 菜单 sheet→锚定 popover                  | 壳                   | 引擎缺陷才修  | —         |
| 4   | Q5 长按窗→滑动拖拽接力                      | 壳                   | 无            | Q3,Q4     |
| 5   | Q7 会话屏顶栏替换+手势改道+⋯聚合            | 壳                   | 无            | Q3        |
| 6   | Q9 导入出处 label（咽喉点盖章）             | server+protocol 常量 | 2 文件小改    | —         |
| 7   | Q2-a 导入屏搜索                             | 壳                   | 无            | —         |
| 8   | Q2-d 刷新动作+分叉警示                      | 壳                   | 无            | Q9        |
| 9   | Q2-b 父链字段 + Q2-c 活跃徽标               | protocol+omp+壳      | optional 字段 | Q9        |
| 10  | Q8-① 工作区三层树（含交互设计补全）         | 壳                   | 无            | Q2-a      |
| 11  | Q8-② 文件屏头部/搜索/diff/git 页签          | 壳                   | 无            | Q8-①      |
| 12  | Q1 语音：配置落地+部署规格+端到端验证       | 配置为主             | 视验证需要    | 端点问题① |
| 13  | Q10 平板横屏设计卡 →（拍板后）实现卡        | 设计→壳              | 设计卡定      | 问题②     |
| 14  | review 轮 + 总验收 +（视问题③）release 构建 | —                    | —             | 全部      |
