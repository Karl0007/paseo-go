# C13 发布构建 + 侧载 + 全功能冒烟

## 背景 / 用户拍板

D3：独立包名共存。基线 = C12 HEAD。

## 设计裁定（照此执行，不得重开）

- release APK：`PASEO_GO=1` 全链路构建（签名=debug keystore 亦可，BUILD.md 记录复用方式）；产物存 `paseo-go/release/`（不 commit APK，commit BUILD 更新）
- 冒烟清单全跑（对照 DESIGN §4-§8 逐条）：双主机连接→会话列表→长按置顶拖拽→进会话发消息→文件浏览→apk 下载分享→收藏→快捷指令执行→导入→搜索→通知→壳设置开关回官方 IA 再回壳
- 版本号策略：`paseo-go/VERSION`（0.1.0），关于页显示

## 范围

- 动：`paseo-go/VERSION`、BUILD.md、evidence/C13/
- 不动：`packages/**`（发现 bug 则回炉立 fix 卡，本卡只冒烟）

## 验收（四项证据契约）

1. typecheck+lint 零错误
2. 全仓测试套件全绿
3. 真实运行：冒烟清单逐项 PASS/FAIL 表
4. 读图：≥4 张关键节点

- 恰好一次 commit；报告含冒烟全表
