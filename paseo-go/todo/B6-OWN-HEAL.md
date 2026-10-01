# B6-OWN-HEAL 所有权自愈+出生轴（F19/D22）

## 语义（编排者裁定，回答「原生还是非原生」）

pill = 活写者轴覆盖出生轴：

1. daemon 持活 provider 进程 → **原生**（paseo，现状已对）；
2. watcher 观测到外部写 → **外部**（external，现状已对）；
3. 空闲/无观测证据（none/undefined）→ **按出生**：daemon launch 出生→原生；import 进来→外部；出生不可考（远古记录）→未知。

## 实施

- **server**：①启动时对存量 agent 批量 attach transcript watcher（有 transcript 路径者；上限+节流+失败静默降级，S2 教训=任何读失败不得炸列表）；②投影纯增出生标记（记录已有 importedFrom/source 事实，核实现状后选最小纯增面；旧端剥键安全）。
- **壳**：ownershipPresentation 判定函数扩第三输入（origin），三处共用（列表 pill/会话页胶囊/a11y）；「未知」仅剩出生不可考。
- 发送守卫等 external 语义消费方**不改**（空闲 import 会话显示外部≠运行中，looksActive 门不动）。

## 验收

- server 定向测：启动 attach 批（含 cap/无路径跳过/读失败不炸）；投影出生标记。
- 壳判定表测：三轴组合全覆盖。
- 真机帧：daemon 重启后列表数秒内从全「未知」自愈为 原生/外部（前后两帧）；import 会话显「外部」、launch 空闲会话显「原生」。
- 恰好一次 commit。
