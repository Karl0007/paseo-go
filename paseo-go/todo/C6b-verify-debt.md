# C6b 文件/预览验证债清偿（C6 预算截断续卡）

## 背景 / 用户拍板

C6（5405e87b）核心链路已真机验证（浏览/图片缩放/收藏 toast/菜单/真 push 返回），但预算截断遗留未验项。C7 依赖收藏区渲染，本卡先行清偿。基线 = C6 HEAD。

## 待验清单（逐项给证据，PASS/FAIL 表进报告）

1. 预览类型实拍：video（信息卡降级态）/apk 信息卡/大 txt 提示卡/html/md/ts 渲染 —— 夹具在 C:/tmp/c5-proj
2. 工作区 tab 收藏区渲染 + 收藏项点击→预览（跨 host 解析）
3. 杀 app 重启：收藏持久
4. host2（srv\_\_Nt1Bm50u1ci，6768）文件浏览+收藏一条 host2 文件
5. 下载→分享面板弹出（apk 或大文件）
6. **添加到对话复核**（C6 疑点）：先打开一个会话再点"添加到对话"，验证跳转/附件行为；确认 C6 观察到的是否 noChat 分支；若 composer 无编程附件接口→改菜单项语义（如复制路径+提示）或记 known_issue 排 P1
7. W1 stash 对照法补跑全量套件（C6 未跑）

## 调查项（不实现，出结论）

8. 视频播放替代路径：**C6 已证 html 预览走官方 CSP webview 管线（FilePane 系）**——优先验证同一 webview 管线直接加载 workspace 视频 URL 能否系统播放；结论 a=可复用（立实现卡）/ b=需新原生依赖（=破零编辑铁律，上报编排者决策）/ c=维持下载后打开降级
9. 添加到对话补充线索：C6 走的是官方 `draft-store.attachWorkspaceFile` seam，目标=同 workspace 最近打开的对话，无则 toast 引导——复核时先开同 workspace 会话再点，确认附件进 composer

## 范围

- 动：验证中发现真 bug 才修（diff 最小化，逐条注明）；evidence/C6b/
- 不动：无验证需求的代码改动禁止

## 工程约束

- R1 纪律全套；CDP 打字器 C:/tmp/c5-cdp-type.mjs；夹具缺就补种
- 修复项须过对应单测；恰好一次 commit（若零修复则零 commit，报告说明）

## 验收

1. 静态门禁（若有修复）2. 套件 stash 对照（第 7 项即本体）3. 真机逐项 PASS/FAIL 4. 读图 ≥6 张存 evidence/C6b/；报告含第 6/8 项结论
