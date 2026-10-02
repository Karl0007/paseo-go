# B8-ROWPILL 行版式右对齐 + pill 三态染色（F21+F22）

## 口径（用户拍板）

1. **F21 微信行版式**：标题行 = `标题(flex-shrink 截断) + pill 紧随 + 时间贴行右缘`。时间=右上小灰字（xs、foregroundMuted、shrink-0）。pill shrink-0，任何标题长度下时间都在右缘不被挤出。副标题行（项目·末条消息）版式不动。置顶/最近段、运行中转圈位置随新行版式微调但语义不动。
2. **F22 pill 染色更明显但不丑**：三态=语义色**浅染底+同系深字**——原生=success 系、外部=warning 系、未知=中性（surface2 底+foregroundMuted 字）。全部走主题 token（明暗双套自动跟随），**禁硬编码 hex**；染色底透明度低饱和（参考 12-16% alpha 观感），禁高饱和大块色。转圈 spinner/「运行中」点缀语义不动。

## 文件域

- `packages/app/src/shell/components/chat-list-row.tsx`（+其 test）
- `packages/app/src/shell/components/ownership-badge.tsx`（+其 test）
- 非目标：导入屏行（B8-IMPORT 域）、手势、缓存。

## 验收

- 组件测：右缘时间布局断言（长标题用例）+ 三态色 token 断言。
- 真机帧：对话 tab 三态 pill 染色清晰可辨 + 时间右缘；帧存 `paseo-go/evidence/B8-ROWPILL/`。
- scoped：`npx vitest run src/shell/components` 绿 + typecheck + oxlint 改动文件。
- **恰好一次 commit**。设备/metro 道次序 ROWPILL>CACHE>WATCH，开工先 hub 报 Main 领道。
