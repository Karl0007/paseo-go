# Paseo 语音输入自部署规格（VOICE-DEPLOY）

> **读者**：执行部署的工程师/Agent（无本仓对话历史）。本文自包含：读完即可在局域网内起一个
> OpenAI 兼容语音转写端点，并通过验收 curl。部署完成后按 §8 回执格式交回参数，Paseo 侧只改配置
> （§6），**零代码改动**。
>
> **背景一句话**：Paseo daemon 的语音功能原默认走 `local` provider（从 GitHub 下载 sherpa-onnx
> 模型，本机网络下载失败且目录内无中文模型）。Paseo 官方内置 `openai` provider（OpenAI SDK 兼容面），
> 只要提供一个满足 §2 契约的自部署 HTTP 端点即可绕开下载路径，并顺带获得中文转写能力。

---

## 1. 部署机假设与推荐栈

### 1.1 最低假设

| 项        | 要求                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 位置      | 与 Paseo daemon 同网段可达（当前 daemon 机 = Windows PC `LAPTOP-K7UNLBKK` / `192.168.31.190`；平板 `192.168.31.14`）。端点可部署在本机 Docker 或局域网任意机器 |
| OS        | Windows 11 + Docker Desktop(WSL2)、或 Linux、或 WSL2 直跑                                                                                                      |
| 运行时    | Docker（推荐）或 Python ≥3.10                                                                                                                                  |
| 显存      | GPU 方案：≥4GB（large-v3 float16 ≈5GB / int8 ≈3GB）；**CPU 方案可行**（听写是短分段，非整段长音频）                                                            |
| 内存/磁盘 | RAM ≥8GB；磁盘预留 ≥10GB（镜像 + 模型 0.5~3GB/个）                                                                                                             |
| 端口      | 建议 `8000`（下文示例均用 `http://192.168.31.190:8000/v1`；换端口/IP 请在回执注明）                                                                            |

### 1.2 推荐栈（三选一；均为社区现成件，不造轮子）

| 方案                                           | 中文能力                                                     | 量级                                                 | 说明                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Speaches（faster-whisper，OpenAI 兼容）** | large-v3 中文强；small/medium 中文一般                       | 模型 0.46~3GB；VRAM float16 ≈2/3/5GB；CPU 可跑（慢） | 单容器，`/v1/audio/transcriptions` 与 `/v1/audio/speech` 都提供。首选：与 Paseo 契约完全同形                                               |
| **B. Xinference + SenseVoiceSmall**            | **中文最优**（zh/en/ja/ko/yue，模型仅 ~0.5GB，CPU 实时率高） | 镜像大（数 GB），模型 ~0.5GB                         | 单容器 + 一条 launch 命令；OpenAI 兼容 `/v1`。追求中文低延迟选它                                                                           |
| **C. whisper.cpp server**                      | 取决于模型（large-v3 ggml 中文强）                           | ggml 模型 ~1.5~3GB，CPU 友好                         | ⚠ **不能直接用**：其内置 server 的路径是 `POST /inference`，**不是** `/v1/audio/transcriptions`。除非你加一层路径/字段改写代理，否则选 A/B |

> ⚠ 通用禁令：不要用 distil-whisper 系（英文专用）；不要只部署英文 tiny/base 当"能用就行"——
> 本部署的动机之一就是中文口述。

---

## 2. 接口契约（Paseo 客户端实况，以代码为准）

Paseo daemon 用官方 **OpenAI Node SDK** 调 `audio.transcriptions.create`
（`packages/server/src/server/speech/providers/openai/stt.ts`）。每次你在 app 上说完一段话，
daemon 发**一次非流式 HTTP 请求**。

### 2.1 STT 请求

```
POST {base}/audio/transcriptions          # base 通常以 /v1 结尾
Authorization: Bearer <apiKey>            # 端点可忽略此头，但必须容忍其存在
Content-Type: multipart/form-data
```

| multipart 字段    | 必发?        | 值                                                                                                                 |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `file`            | 恒发         | WAV 音频：**24000 Hz / 单声道 / 16-bit PCM**（44 字节标准 WAV 头），文件名 `audio-<uuid>.wav`，段长通常 0.5~30s    |
| `model`           | 恒发         | Paseo 配置里的模型名字符串（默认 `whisper-1`，可配，见 §6）。**端点必须接受该名字**（或忽略 model 字段）           |
| `language`        | **恒发**     | ISO-639-1 码；**默认 `"en"`**（中文场景务必按 §6 配成 `zh`）。端点应支持或忽略，不得因该字段报错                   |
| `response_format` | 恒发         | 固定 `"json"`                                                                                                      |
| `prompt`          | 仅当上层传入 | 听写链路当前不传；可忽略                                                                                           |
| `include`         | 条件发       | 仅当 model 名恰为 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 时发 `["logprobs"]`；whisper 类模型名**不会触发** |

### 2.2 STT 响应（成功）

```
HTTP 200
Content-Type: application/json

{ "text": "转写出的文本" }
```

| 响应字段                                         | 必需?    | 客户端行为                              |
| ------------------------------------------------ | -------- | --------------------------------------- |
| `text` (string)                                  | **必需** | 直接作为转写结果插入输入框              |
| `logprobs` (array of `{token, logprob, bytes?}`) | 可选     | 有则算平均 logprob 做置信度判定（§2.4） |
| `language` (string)                              | 可选     | 透传展示                                |

`verbose_json`、时间戳等均**不请求**；额外响应字段客户端忽略。

### 2.3 错误语义

- 非 2xx / JSON 解析失败 / 连接失败 → 客户端抛 `STT transcription failed: <原因>`，app 端听写条进入
  **可重试失败态**（重试按钮），daemon 不落错误冻结态。
- 端点若要求鉴权，给 Paseo 配对应 key 即可（§6 `apiKey` 字段）；无鉴权则忽略 `Authorization` 头。
- 建议端点秒级返回；OpenAI SDK 默认自带重试，长挂起会拖慢 app 反馈。

### 2.4 置信度 / `STT_CONFIDENCE_THRESHOLD` 行为结论（重要）

- 阈值语义：**平均 logprob 比较线，负对数域**，默认 `-3.0`（非 0~1 概率）。仅当响应带
  `logprobs` 时生效：`avg(logprob) < 阈值` → 该段标记 `isLowConfidence`（低置信提示）。
- **logprob 缺席时的行为（以代码为准）**：`logprobs` 缺失/类型不符 → 客户端视为**无置信度信息，
  不判低置信**（`isLowConfidence=false`），转写照常返回。
- 结论：**whisper 类自部署端点无需实现 logprobs**，契约最小集就是 §2.2 的 `{"text"}`。
  只有当你把 Paseo 的模型名配成 `gpt-4o-transcribe*` 时客户端才会请求 `include=["logprobs"]`——
  自部署场景不要起这种模型名。

### 2.5 TTS 面（可选，仅"语音对话模式"的回读需要；语音输入不需要）

```
POST {base}/audio/speech
{ "model": "tts-1" | "tts-1-hd", "voice": "alloy"|"echo"|"fable"|"onyx"|"nova"|"shimmer",
  "input": "<文本>", "response_format": "pcm" }
→ HTTP 200，裸 PCM 字节流（s16le / 24kHz / 单声道）
```

⚠ **枚举限制**：客户端把 `model`/`voice` 钉死为上述 OpenAI 枚举值（config 层 zod 校验，越界值直接
回落默认）。开源 TTS 服务（Kokoro/Speaches 等）模型名与音色名不同，**除非端点显式接受
`tts-1`+`alloy` 这组名字，否则 TTS 面视为不可用**。语音输入（本卡主题）不依赖 TTS。

---

## 3. 方案 A：Speaches（推荐起步，逐条可复制）

前置：Docker Desktop（Windows 开 WSL2 后端）或 Linux Docker + NVIDIA Container Toolkit（GPU 时）。

```bash
# 3A.1 起服务（CPU 版；有 NVIDIA GPU 用 latest-cuda 并加 --gpus all）
docker run -d --name speaches --restart unless-stopped \
  -p 8000:8000 \
  -v speaches_hf:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:latest-cpu

# 3A.2 拉中文可用的 STT 模型（large-v3 中文强；CPU 嫌慢可换 medium/small）
docker exec speaches uv tool run speaches-cli model download Systran/faster-whisper-large-v3
# （GPU 版镜像内用户/路径若不同，以 docker exec -it speaches sh 实际确认为准）

# 3A.3 自检：生成一个 3 秒测试 wav（需 ffmpeg；或放任意一段中文语音 wav）
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -ar 24000 -ac 1 test.wav

# 3A.4 验收 curl（见 §7；模型名用你下载的 ID）
curl -sS -X POST "http://127.0.0.1:8000/v1/audio/transcriptions" \
  -F "file=@test.wav" -F "model=Systran/faster-whisper-large-v3" \
  -F "language=zh" -F "response_format=json"
```

防火墙（Windows 部署机必做，供平板/其他机器访问）：

```powershell
New-NetFirewallRule -DisplayName "speaches-8000" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
```

## 4. 方案 B：Xinference + SenseVoiceSmall（中文最优）

```bash
# 4.1 起服务（GPU；CPU 用 xprobe/xinference:latest-cpu 并去掉 --gpus all）
docker run -d --name xinference --restart unless-stopped \
  -e XINFERENCE_MODEL_SRC=modelscope \
  -p 9997:9997 --gpus all \
  xprobe/xinference:latest xinference-local -H 0.0.0.0

# 4.2 拉起 SenseVoiceSmall（audio 类；首次会下载 ~0.5GB 模型）
docker exec xinference xinference launch \
  --model-name SenseVoiceSmall --model-type audio

# 4.3 验收 curl（base = http://<部署机IP>:9997/v1，model = SenseVoiceSmall）
curl -sS -X POST "http://127.0.0.1:9997/v1/audio/transcriptions" \
  -F "file=@test.wav" -F "model=SenseVoiceSmall" -F "language=zh"
```

⚠ SenseVoice 特性：原始输出可能带 `<|zh|><|NEUTRAL|>` 等标签；若验收发现转写文本带标签，需在部署侧
启用去标签（Xinference 新版本已处理；老版本升级或换 whisper large-v3）。

## 5. 方案 C：whisper.cpp（仅说明为何不默认推荐）

whisper.cpp 自带 `server` 只暴露 `POST /inference`（multipart `file`+`language`，响应含 `text`），
路径与 Paseo 契约（§2.1）**不符**，且 OpenAI SDK 不会改路径。要用它必须加一层改写代理
（如 nginx `location /v1/audio/transcriptions { proxy_pass .../inference; }`——字段大体兼容但
`model`/`response_format` 需确认被忽略）。除非已有 whisper.cpp 存量部署，否则直接选 A/B。

---

## 6. Paseo 侧配置（部署完成后由用户执行；本卡不碰用户 `~/.paseo`）

### 6.1 持久化 config（推荐）

编辑 `~/.paseo/config.json`（Windows 用户 = `C:\Users\<你>\.paseo\config.json`）。
⚠ **合并写入，不要整文件覆盖**——现有文件里可能有 `daemon.auth.password` 等关键配置。
需要合并进 `features` / `providers` 两个顶层键：

```json
{
  "features": {
    "dictation": {
      "stt": { "provider": "openai", "model": "<部署回执里的 stt_model>", "language": "zh" }
    },
    "voiceMode": {
      "stt": { "provider": "openai", "model": "<部署回执里的 stt_model>", "language": "zh" }
    }
  },
  "providers": {
    "openai": {
      "stt": { "apiKey": "dummy", "baseUrl": "http://<部署机IP>:<端口>/v1" }
    }
  }
}
```

要点（均为代码实况）：

- `apiKey` **必须非空**——`providers.openai.stt.apiKey`（或 env，见 §6.2）缺失时整个 openai 语音
  配置不解析，语音直接不可用。端点无鉴权也填 `"dummy"`。
- `language: "zh"`：客户端**恒发** `language` 字段且默认 `"en"`；不设 zh，whisper 会被强制按英文
  解码，中文口述出垃圾。
- `model`：填端点实际接受的模型名（Speaches=HF ID 如 `Systran/faster-whisper-large-v3`；
  Xinference=`SenseVoiceSmall`）。不填默认 `whisper-1`——端点若不认这个名字会在转写时报错。
- TTS 面（`features.voiceMode.tts`）：语音输入不需要 TTS。语音对话模式的回读：端点不满足 §2.5
  枚举限制就**保持 `local`**（用户机 `~/.paseo/models/local-speech/.downloads/` 已有 kokoro 完整归档，
  daemon 重启会本地解压、不再走网络），或接受回读失败——不要为此把 tts 也指向无 `/audio/speech` 的端点。
- 生效方式：**重启用户自己的 daemon**（用户动作：重启 Paseo 桌面端/守护进程；本卡与部署 Agent
  均不得代做）。重启后 app 点语音输入应进入录音态；实际转写应出中文文本。

### 6.2 env 变量替代面（daemon 进程环境变量）

| env                                                    | 等价 config 路径                                                | 说明                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PASEO_DICTATION_STT_PROVIDER=openai`                  | `features.dictation.stt.provider`                               | 听写开关面                                                         |
| `PASEO_VOICE_STT_PROVIDER=openai`                      | `features.voiceMode.stt.provider`                               | 语音对话 STT                                                       |
| `OPENAI_STT_BASE_URL`                                  | `providers.openai.stt.baseUrl`                                  | 端点 base（含 `/v1`）                                              |
| `OPENAI_STT_API_KEY`                                   | `providers.openai.stt.apiKey`                                   | 无鉴权填 dummy                                                     |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY`                   | `providers.openai.baseUrl` / `.apiKey`                          | 通用回退面                                                         |
| `STT_MODEL`                                            | `features.dictation.stt.model` + `features.voiceMode.stt.model` | 一处设两脸                                                         |
| `STT_CONFIDENCE_THRESHOLD`                             | `features.dictation.stt.confidenceThreshold`                    | 平均 logprob 阈值（负值，默认 -3.0；无 logprob 时不参与，见 §2.4） |
| `PASEO_DICTATION_LANGUAGE` / `PASEO_VOICE_LANGUAGE`    | `features.*.stt.language`                                       | 中文=zh                                                            |
| `PASEO_DICTATION_ENABLED` / `PASEO_VOICE_MODE_ENABLED` | `features.*.enabled`                                            | 总开关                                                             |

⚠ 优先级细节：`model`/`language`/`provider` 类 **env 压过 config**；但 **apiKey/baseUrl 是
`providers.openai.stt.*`（config）压过 env**（解析顺序 stt 专属 → env 专属 → 通用 config → 通用 env）。
若 config 里已写 dummy/占位 baseUrl，改 env 不生效，必须改 config。

## 7. 验收 curl（部署完成的判据）

```bash
# 用任意 3~10 秒中文语音 wav（手机录音转 wav 即可；24k/16k/44.1k 单声道均可，端点会自处理）
curl -sS -w "\nHTTP %{http_code}\n" -X POST \
  "http://<部署机IP>:<端口>/v1/audio/transcriptions" \
  -H "Authorization: Bearer dummy" \
  -F "file=@zh-sample.wav" \
  -F "model=<stt_model>" \
  -F "language=zh" \
  -F "response_format=json"
```

**通过标准**：`HTTP 200` 且响应体是 JSON、含非空字符串 `text` 字段、内容≈所听内容（中文）。
失败排查顺序：端口/防火墙 → 路径（必须 `/v1/audio/transcriptions`）→ model 名不被接受 → 音频格式。

## 8. 部署回执格式（部署完成后原样填好交回）

```
VOICE-DEPLOY-RECEIPT
stack:        speaches | xinference-sensevoice | other:<名>
base_url:     http://<IP>:<端口>/v1
stt_model:    <端点实际接受的 model 字符串>
auth:         none | Bearer <key>（Paseo 侧将原样填入 apiKey）
curl_check:   PASS | FAIL（附 §7 的 HTTP 码与响应 text 原文）
tts:          no | yes（仅当接受 model=tts-1 + voice=alloy + response_format=pcm）
firewall:     <已放行端口说明>
notes:        <其他（模型大小写敏感、并发限制、SenseVoice 标签是否已剥离等）>
```

Paseo 侧收到回执后的动作 = 按 §6.1 改 `~/.paseo/config.json` + 用户重启 daemon + 真机听写一句话闭环。

---

### 附：本仓开发环境已按本规格预配置（dev daemon，非用户机）

`.dev/paseo-home/config.json` 已切 `dictation/voiceMode.stt → openai`（baseUrl 占位
`http://192.168.31.190:8000/v1`，apiKey=`dummy`），devd 就绪态无 `model_download_failed`；
端到端转写待上述回执落地。证据=`paseo-go/evidence/C28/`，卡=`paseo-go/todo/C28-voice-openai-provider.md`。
