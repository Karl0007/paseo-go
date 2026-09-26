# C28 语音：切 OpenAI 兼容 provider（配置落地）+ 部署规格交付

## 背景 / 用户拍板

用户：「语音输入用不了」（toast=daemon 侧 `model_download_failed (fetch failed)`，GitHub 下载失败+失败态冻结+无代理+本地无中文模型）。用户有自部署模型意向，裁定 DESIGN §14.2：切官方现成 OpenAI 兼容 provider 面（纯配置），local 下载路径整体绕开。**用户终裁：本卡只做配置落地+部署规格；端到端真机验证挂起待用户部署端点**（明示挂起项，非欠账）。

## 设计裁定（照此执行，不得重开）

1. **核实请求形态**（先做，写进规格）：读 `providers/openai/stt.ts` 的 transcription 调用（OpenAI SDK `audio.transcriptions.create`？是否 verbose_json/带 timestamp 请求 logprob 置信度路径？）与 `tts.ts`；确定自部署端点必须满足的**最小契约**（路径、multipart 字段、响应 JSON、置信度不可得时的行为——`STT_CONFIDENCE_THRESHOLD` 的语义）。
2. **dev daemon 配置落地**（`.dev/paseo-home/config.json`，持久化 config 路径，重启 devd 生效——devd 是 hub 管理的开发 daemon，**允许重启**；⚠ 用户真 daemon `~/.paseo` **绝不碰**）：
   - `features.dictation.stt.provider="openai"`、`features.voiceMode.stt.provider="openai"`、`features.voiceMode.tts.provider` 保持 local（TTS 无端点需求，语音输入=STT；若 TTS 面残留下载失败态一并切走或禁用，报告说明）；
   - `providers.openai.stt.apiKey="dummy"`（无鉴权端点也要非空——config.ts 解析规则）+ `baseUrl` 占位（规格里给示例 `http://192.168.31.190:8000/v1`）。
3. **交付 `paseo-go/VOICE-DEPLOY.md`**（中文，规格文档）：推荐栈两三个（whisper.cpp server / faster-whisper OpenAI 兼容 API / SenseVoice 壳——含中文能力、显存/磁盘量级、Windows/WSL/Docker 部署一行命令级指引）；**接口契约表**（POST {base}/audio/transcriptions、multipart `file`+`model`、响应 `{text}`、语言参数是否可用）；`~/.paseo/config.json` 的确切片段 + 重启指引（用户动作）；env 变量替代面（`OPENAI_STT_BASE_URL/API_KEY`、`STT_MODEL`、`PASEO_DICTATION_STT_PROVIDER`）；TTS 面枚举限制（tts-1/6 voice）说明。
   - **交接对象=外部部署 Agent（无对话历史）**：文档必须自包含——部署机假设（OS/显存/磁盘下限）、逐条可复制命令（安装→拉模型→起服务→curl 自检）、API 契约与错误语义、"部署完成后把 base URL/model 名交回"的回执格式、验收 curl 样例（multipart 上传 wav→期望 JSON）。不引用本仓会话上下文，不写"见讨论"。
4. **验证（无端点条件下）**：重启 devd 后语音就绪态**不再出现 model_download_failed**（读 readiness：`fetch_*` 响应或 daemon.log 的 speech readiness 行）；app 端 toast 消失、录音 UI 可进入；实际转写失败=预期（known_issue 挂起项，规格交付后由用户端点闭环）。

## 范围

- 动：`.dev/paseo-home/config.json`（运行态，不 commit）、`paseo-go/VOICE-DEPLOY.md`（新）、`paseo-go/todo/C28` 卡尾验证记录、（如需）`paseo-go/BUILD.md` 语音一行指路
- 不动：**用户真 daemon `~/.paseo` 一切文件与进程**；server 代码（provider 机制现成，零改动）；壳代码

## 验收（证据契约裁剪版——配置卡）

1. 无代码改动则门禁免跑；若动了任何 ts 文件=违规（本卡零代码）。
2. daemon 重启后 readiness 证据：daemon.log 片段（speech 段无 model_download_failed / provider=openai）存 `paseo-go/evidence/C28/`。
3. 真机：语音按钮不再弹 model_download_failed toast，录音态可进入（截图）。
4. 读图 ≥2 + 报告 JSON：known_issues 必含「端到端转写待用户端点，规格=VOICE-DEPLOY.md」。

- 恰好一次 commit（仅文档）。

## 验证记录（C28 执行，2026-09-27）

**零代码改动**（`git status packages/` 仅既有未跟踪构建桩 `packages/app/packages/`，非本卡产物）。

1. **配置落地**（`.dev/paseo-home/config.json`，不入库）：
   `features.dictation.stt.provider=openai`、`features.voiceMode.stt.provider=openai`、
   `providers.openai.stt/tts.apiKey="dummy"` + `baseUrl="http://192.168.31.190:8000/v1"`（占位=本计划署地
   址；未设 baseUrl 会回落 api.openai.com——dummy key 外发请求不妥，占位 localhost/LAN 使失败留在网内，
   就绪态不受影响=代码实况：baseUrl 仅进 SDK 构造，不探测连通性）。hub restart devd ×2 生效。
2. **TTS 面处置（按卡内"残留下载失败态一并切走"条款，偏离卡首选项处说明）**：`voiceMode.tts` 若保持
   local，`computeRequiredLocalModelIds`（local/runtime.ts:89-94）仍要求 kokoro-en-v0_19；dev home
   models 目录为空 → 后台下载 → fetch failed → `model_download_failed` 必残留（卡验收 3 直接不过）。
   故 tts 一并切 `openai`（dummy key）。副作用消解：三 provider 全非 local 后
   `shouldIncludeLocalProviderConfig` 本会关掉 local worker → `voiceTurnDetection`（默认 local，silero
   随包不下载）会 `turn_detection_unavailable`；dev-daemon.sh:12-14 恒 export
   `PASEO_LOCAL_MODELS_DIR=$HOME/.paseo/models/local-speech`（先于 config 解析、且 env 压过
   `providers.local.modelsDir`，故 config 未写该项）使 worker 恒在（懒启动）→ realtimeVoice 保持 ready。
   **用户 `~/.paseo` 实况：本卡未读写其任何文件、未动其进程**；devd 对该 models 目录 required=[] →
   无下载无写入（silero 复制仅在真正开语音对话时发生，本卡未触发）。
3. **daemon 就绪态证据**（`paseo-go/evidence/C28/`）：
   - `daemon-speech-section.txt`：reconciliation completed，
     `effectiveProviders={dictationStt:"openai", voiceStt:"openai", voiceTts:"openai", voiceTurnDetection:"local"}`，
     无 model_download_failed / 无 download 行（boot 后全 log 扫描 0 命中）。
   - `ws-readiness.json`（探针 `c28-readiness-probe.mjs`）：server_info
     `capabilities.voice={dictation:{enabled:true,reason:""},voice:{enabled:true,reason:""}}`。
4. **真机**（AHPEBB1826005071 / app.paseo.shell.debug / metro 反代）：
   - `c28-1-composer.png`：输入栏"开始听写"麦克风可用；
   - `c28-2-recording.png`：点按后进入录音态（绿条+计时 00:23+取消/插入/发送），**无
     model_download_failed toast**（首次弹系统录音权限，已授"仅使用期间"）；
   - `c28-3-failed.png` + `daemon-transcription-error.txt`：commit 后端点缺失 →
     `听写失败：STT transcription failed: Connection error.`（daemon 侧
     `ECONNREFUSED 192.168.31.190:8000`，OpenAISTT 路径）+ 可重试态 = **预期挂起行为**，
     随后取消听写还原。
5. **交付**：`paseo-go/VOICE-DEPLOY.md`（自包含交接件：部署机假设/三栈含中文能力与量级/接口契约表/
   STT_CONFIDENCE_THRESHOLD 无 logprob 行为结论（缺席=不判低置信，whisper 端点零要求）/错误语义/
   逐条命令/验收 curl/~/.paseo 配置片段+env 替代面+优先级细节/TTS 枚举限制/回执格式）。
   BUILD.md 已知问题 #9 加指路一行。

**挂起项（用户终裁，非欠账）**：端到端转写待用户部署端点；闭环路径=VOICE-DEPLOY.md §8 回执 → §6.1
配置 → 用户重启真 daemon → 真机中文听写。dev 配置未设 `language:"zh"`（卡内键集外；规格 §6.1 已标注
客户端恒发 language 默认 en 的坑，用户配置务必带上）。
