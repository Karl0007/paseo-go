# C13 发布构建 + 侧载 + 全功能冒烟

## 背景 / 用户拍板

D3：独立包名共存。基线 = C12 HEAD。

## 设计裁定（照此执行，不得重开）

- release APK：`PASEO_GO=1` 全链路构建（签名=debug keystore 亦可，BUILD.md 记录复用方式）；产物存 `paseo-go/release/`（不 commit APK，commit BUILD 更新）
- 冒烟清单全跑（对照 DESIGN §4-§8 逐条）：双主机连接→会话列表→长按置顶拖拽→进会话发消息→文件浏览→apk 下载分享→收藏→快捷指令执行→导入→搜索→通知→壳设置开关回官方 IA 再回壳
- **C3 遗留人工项**：置顶拖拽在 C3 新 hook（use-shell-row-drag-menu）下 adb 注入无法复现换位（JS 触摸滞后伪影），须**真人手指**拖一次置顶行验证落位+持久化（平板在，5 秒的事），截图存证
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

## 勘误(C13-F1,2026-09-26)

冒烟报告(commit d3bdb134 报告体+hub)中「文件搜索零命中=回归,立卡 C13-F1」一项**改判**:
非产品缺陷,系 adb 注入文本被百度输入法滑词/预测候选吞改(`build`→`builder…`)导致的
**测试工具伪影**。换 ADBKeyboard 直提交后,在装正式包(sha 42b55f09)一发命中 BUILD.md
(evidence/C13F1/02、03 实拍)。C13 冒烟该项实际 PASS(17/17,拖拽人工项状态不变);
全链静态核对+动态探针定性、键契约加固与注入配方见 todo/C13-F1-file-search-regression.md
卡尾与 BUILD.md §4 输入条目(同款"注入伪影"处理先例:C1 收卡勘误)。
