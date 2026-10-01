# Paseo Go 服务端部署指南

> 读者：在一台新机器上部署 Paseo Go 服务端（daemon）的人，不预设任何背景。
> 服务端 = `@getpaseo/cli` fork 包（daemon 与 CLI 同包发布）。手机 APK / 浏览器只是它的客户端，服务器上不装 APK。
> 发布物与校验表：`https://github.com/Karl0007/paseo-go/releases/latest`。

## 前置

| 项        | 要求                                                                              |
| --------- | --------------------------------------------------------------------------------- |
| Node.js   | 22 或更高（包为全量 vendored：安装不访问 registry、不跑编译脚本）                 |
| 网络      | 机器装 Tailscale 并加入你的 tailnet。daemon 只监听 Tailscale 网卡                 |
| agent CLI | 要驱动哪个 agent 就装哪个（omp / claude / codex / copilot / opencode），PATH 可用 |
| 平台包    | Windows 机必须用 win32 包，Linux 用 linux 包（含 node-pty 平台二进制，不跨平台）  |

## 安装

```bash
# 1. 下载对应平台的 CLI tarball（Releases 页，文件名形如 getpaseo-cli-<版本>-<平台>.tgz）

# 2. 先校验再安装：sha256 必须与 Release 正文校验表逐字符一致，不符绝不继续
sha256sum getpaseo-cli-<版本>-<平台>.tgz        # Windows: certutil -hashfile <文件> SHA256

# 3. 全局安装
npm i -g ./getpaseo-cli-<版本>-<平台>.tgz

# 4. 设置连接密码（交互式；手机 App / Web UI / CLI 通用，磁盘只存 bcrypt hash）
paseo daemon set-password
```

## 配置 `~/.paseo/config.json`

```json
{
  "listen": "<本机 tailscale IP>:6767",
  "relay": { "enabled": false },
  "agents": { "providers": { "omp": { "enabled": true } } },
  "features": { "webUi": { "enabled": true } }
}
```

- `listen` 只写 Tailscale IP。**禁止** `0.0.0.0` 或局域网地址，防火墙不放行 6767：这个 daemon 能驱动带完整 shell 权限的 agent。
- provider 默认禁用是常态。`provider ls` 显示 unavailable 时先在 config 显式 `enabled: true`，不要重装；"Bun runtime unavailable" 是装饰行，native 安装的 omp 不需要 bun。
- 改 `listen` / auth / relay / webUi 属启动级设置，改完必须重启服务；`paseo reload` 只处理运行时项。

## 常驻运行

两条禁忌，各源于一次真实故障：

1. **禁止从 SSH / 终端 / 临时 shell 直接 `paseo daemon start`。** 进程会附着在该 shell 的 ConPTY 上，shell 被回收时 daemon 陪葬。合法祖谱：Windows 为 `svchost ← services ← wininit`，Linux 为 systemd。
2. **禁止安装 Paseo Desktop。** 它与 daemon 共用 `~/.paseo` 与监听端口，必然冲突。管理界面用浏览器开 `http://<tailscale IP>:6767/`。

### Windows：任务计划程序

建任务 `PaseoDaemon`：

- Action：`<用户目录>\.paseo\run-foreground.cmd`（内容：5 秒循环重拉 `paseo daemon run`，崩溃自愈靠循环本身）
- Trigger：AtStartup；Principal：当前用户、**存密码**、RunLevel Highest
- Settings：RestartCount 999/1min、ExecutionTimeLimit 0（不限）、AllowStartIfOnBatteries、DontStopIfGoingOnBatteries、MultipleInstances=IgnoreNew

任务运行中不要编辑 `run-foreground.cmd`（cmd 按偏移续读会错乱）；改完 Stop/Start 任务。

### Linux：systemd

```ini
# /etc/systemd/system/paseo.service
[Unit]
Description=Paseo daemon
After=network-online.target

[Service]
User=<你的用户>
ExecStart=/usr/bin/env paseo daemon run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now paseo
```

## 验收（全绿 = 别再动它）

```bash
curl -s http://<tailscale IP>:6767/api/health
# 期望 {"status":"ok",...}

curl -s -o /dev/null -w "%{http_code}\n" http://<tailscale IP>:6767/api/sessions
# 期望 401（密码闸生效；返回 200 = 未设密码，回去跑 set-password）

PASEO_PASSWORD=<密码> paseo --host tcp://<tailscale IP>:6767 provider ls
# 期望目标 provider 为 available / Enabled（启动后前 ~30s 可能显示 loading，稍等再查）
```

Windows 另查：`(Get-ScheduledTask PaseoDaemon).State` = Running。

## 客户端接入

手机 Paseo Go（或官方 Paseo App）添加服务器：地址 `tcp://<tailscale IP>:6767`，密码即 set-password 所设。手机侧同样需 Tailscale 在线；连不上先查两端 tailscale 状态，再查密码是否被改过。

## 升级与回滚

```bash
# 升级 = 下载新 tarball → 校验 sha → npm i -g <tgz> → 重启服务（旧 supervisor 配新 worker 路径会崩）
# 回滚 = 装回上一个留存 tarball；或退回官方版 npm i -g @getpaseo/cli@<registry 最新版>（壳私有能力失效）
```

- **禁止 `npm update -g @getpaseo/cli`**：会把 fork 覆盖回官方版，Paseo Go 壳的私有能力（导入树、所有权标记、内容搜索）随之失效。
- 留存最近一个旧版 tarball 作为回滚件，放在部署机本地。

## 故障排查入口

| 症状                  | 先看                                                            |
| --------------------- | --------------------------------------------------------------- |
| 服务起不来 / 反复重启 | `~/.paseo/daemon.log`、Windows 加看 `wrapper.log`               |
| 端口被占              | 查占用进程祖谱；挂在终端/shell 下的是违规野进程，杀掉后重启服务 |
| provider 不可用       | config 显式 enabled（见上），不是重装                           |
| 手机连不上            | 验收三条 → 两端 tailscale 状态 → 密码                           |
