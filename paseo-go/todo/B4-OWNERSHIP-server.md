# B4-OWNERSHIP-SERVER: 所有权状态机 数据面（F8 lite 的 server 侧）

来源：BATCH4-ALIGNMENT.md F8（裁定 13，R2-full 不做）。

## 口径

1. 协议纯增 agent 目录 `ownership: "paseo"|"external"|"none"`（messages.ts 触点+validators）。
2. 推导：daemon 进程活=paseo；死且 transcript 无外部变=none；死且 watcher 报外部变=external。
3. R3：transcript fs.watch+防抖→tail 重读→timeline 增量+lastMessagePreview 更新（复用 B4-PREVIEW 链）；stat 轮询兜底（间隔入 config 默认 60s，网络盘场景）。
4. R5：resume 成功→ownership=paseo 记账；进程退出→按规则回落。
5. 各 provider transcript 路径知识收口一函数（omp/claude/codex/opencode/pi；缺路径=永不 external）。
6. 测试：状态机纯函数单测+watcher 集成（tmpdir 造 transcript 外部写）+ws 探针实录三态。

## 验收

门禁+protocol/server 套件对照零新增+探针三态实录；触点申报；UI 不在本卡（OWNERSHIP-UI 消费）。

## 调研回写（B4-RESEARCH 结论 2026-09-30，Main 采纳）

- R2-full **永久关闭**（五 provider 零字节损坏，危险在语义层）；预算并回本卡。
- looksActive 升级信号：claude=`~/.claude/sessions/<pid>.json` 注册表（sessionId→pid 探活，精确）；codex/omp=独占打开 transcript 失败=有活者；pi/opencode=mtime/size 启发。
- R3 tail 解析纪律：未知 type 行必须跳过（claude 元行/omp-pi 无版本头）。
- provider 语义差异入状态机注释：omp/pi 活写者保最后叶、claude 外部支可能胜出、codex 交错无 fork、opencode 共享 DB 天然可见。
