# C28 语音：切 OpenAI 兼容 provider（配置落地）+ 部署规格交付

## 背景 / 用户拍板

用户：「语音输入用不了」（toast=daemon 侧 `model_download_failed (fetch failed)`，GitHub 下载失败+失败态冻结+无代理+本地无中文模型）。用户有自部署模型意向，裁定 DESIGN §14.2：切官方现成 OpenAI 兼容 provider 面（纯配置），local 下载路径整体绕开。**用户终裁：本卡只做配置落地+部署规格；端到端真机验证挂起待用户部署端点**（明示挂起项，非欠账）。

## 设计裁定（照此执行，不得重开）

1. **核实请求形态**（先做，写进规格）：读 `providers/openai/stt.ts` 的 transcription 调用（OpenAI SDK `audio.transcriptions.create`？是否 verbose_json/带 timestamp 请求 logprob 置信度路径？）与 `tts.ts`；确定自部署端点必须满足的**最小契约**（路径、multipart 字段、响应 JSON、置信度不可得时的行为——`STT_CONFIDENCE_THRESHOLD` 的语义）。
2. **dev daemon 配置落地**（`.dev/paseo-home/config.json`，持久化 config 路径，重启 devd 生效——devd 是 hub 管理的开发 daemon，**允许重启**；⚠ 用户真 daemon `~/.paseo` **绝不碰**）：
   - `features.dictation.stt.provider="openai"`、`features.voiceMode.stt.provider="openai"`、`features.voiceMode.tts.provider` 保持 local（TTS 无端点需求，语音输入=STT；若 TTS 面残留下载失败态一并切走或禁用，报告说明）；
   - `providers.openai.stt.apiKey="dummy"`（无鉴权端点也要非空——config.ts 解析规则）+ `baseUrl` 占位（规格里给示例 `http://192.168.31.190:8000/v1`）。
3. **交付 `paseo-go/VOICE-DEPLOY.md`**（中文，规格文档）：推荐栈两三个（whisper.cpp server / faster-whisper OpenAI 兼容 API / SenseVoice 壳——含中文能力、显存/磁盘量级、Windows/WSL/Docker 部署一行命令级指引）；**接口契约表**（POST {base}/audio/transcriptions、multipart `file`+`model`、响应 `{text}`、语言参数是否可用）；`~/.paseo/config.json` 的确切片段 + 重启指引（用户动作）；env 变量替代面（`OPENAI_STT_BASE_URL/API_KEY`、`STT_MODEL`、`PASEO_DICTATION_STT_PROVIDER`）；TTS 面枚举限制（tts-1/6 voice）说明。
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
