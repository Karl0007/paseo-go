# C13 hermesc 验证记录（WSL2 探路 → 原生 win64 定稿）

## 结论（定稿链路）

**原生 win64 `hermesc.exe`（npm debug 构建）在整机空闲（FreeVis ≥ 23GB）下直接编译成功**：
exit 0，用时 ~5 分钟，**峰值 commit ~21GB**（实测采样：60s=1.5GB → 150s=20.4GB → 峰值 21.1GB → 回落）。
不需要页面文件，不需要 WSL2。debug 构建的 OOM 本质=commit 上限问题，不是物理内存问题——
此前所有失败轮 FreeVis 只有 15-19GB（metro/双 daemon/双 agent 并发所致，印证已知问题#6）。

产物验证：`C:/tmp/win-out.hbc` 40,180,431 B，sha256=`17DDD9DDD691B32CBD9A8561C68A40BD52949994AF347C121E11825E059A1BC7`
（对应 F6b 之前的 bundle，仅作机制验证；最终 APK 用 build-release-wsl.sh 对新鲜 bundle 重编译，
脚本含防呆断言：bundle sha 与 phase1 记录一致 + hbc mtime ≥ bundle mtime）。
header 12 字节 `c6 1f bc 03 c1 03 19 1f 60 00 00 00` 与同二进制 tiny.js 参考产物同构（后随 per-file hash）；
终极校验=装机首启（冒烟第 0 步）。

## WSL2 探路记录（保留为降级路线，脚本 phase2 fallback 分支）

| 轮                      | 配置                                                       | 结果                                                                                         | 教训                                                                          |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 16GB VM，输出直写 drvfs | 90s exit 0，RSS 7.76GB                                     | **产物 0 字节**：hermesc 对输出文件 mmap 写，drvfs 上静默失败                                | 输出必须先落 VM 本地 fs（tmpfs）再 cp 回                                      |
| 10GB 帽                 | ~90s 被 VM 内 OOM killer 杀（RC=9，峰值 9.3GB）            | optimized linux hermesc 真实峰值 ~12-14GB                                                    | `.wslconfig` 必须 memory=16GB                                                 |
| 12GB 帽                 | 1m36s 峰值 11.8GB 被杀                                     | 同上                                                                                         | 同上                                                                          |
| 16GB + tmpfs 输出       | 未跑成：多轮强杀 wsl.exe 后 docker-desktop rootfs 全局只读 | `wsl --shutdown`/`--set-sparse` 均不解；`--unregister` 可清（Docker Desktop 下次启动自重建） | wsl.exe 客户端被杀=会话即停+发行版秒退，产物随 tmpfs 蒸发；构建窗口内别动 omp |
| /dev/shm 兜底           | tmpfs 可写验证 OK（rootfs ro 时 /dev/shm 仍 rw）           | 可行但未用（原生链路已成功）                                                                 | —                                                                             |

其他 WSL2 事实：`linux64-bin/hermesc --version` = "Optimized build"，`win64-bin/hermesc.exe` = "DEBUG build"
（Meta 官方 CLI release 只发到 v0.13.0/RN0.75，同样是 debug 构建且更旧）；docker-desktop 发行版每次重启
drvfs 挂载丢失需重 mount；`autoMemoryReclaim` 键本机 wsl 版本不支持。

## 构建窗口纪律（写进 BUILD.md §3.5/已知问题#6）

hermesc 5 分钟窗口内整机独占：metro、双 daemon、vitest、其他重 agent 全停；
编排者广播"构建窗口开始/结束"，窗口后秒级重建 daemon 供冒烟。
