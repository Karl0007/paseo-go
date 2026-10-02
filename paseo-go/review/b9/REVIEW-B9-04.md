# REVIEW-B9-04 [P2] leaf stat 瞬时失败吞掉已消费的树计数移动，活跃期徽标整轮丢失

## 现象/根因

子任务出现(0→N)恰落 leaf stat 失败拍（:691-693 size===null return 丢弃已算 changed；:770 扫描闸已先落 lastSubagentScanMs）→ 下拍被闸、count 不变 changed=false→移动永久丢。onChange 抛错同型（:745）。

## 修复方向

「待报移动」做成 entry 状态（pendingTreeReport），任何早退路径保留 pending，下一拍凭 pending 补发（不双报不丢报）。

## 验收

注入 leaf stat 失败与子出现同拍：该拍无报告、恢复后下一拍恰好上报一次 count=N；「衰减恰好一次」不回归。修复前必红。

## 复核（复核 Agent 填）

结论：
理由/证据：
