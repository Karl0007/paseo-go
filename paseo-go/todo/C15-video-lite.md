# C15 视频 a-lite 内嵌预览（P2 可选，最后做或不做）

## 背景 / 用户拍板

C6b 调查（evidence/C6b/22-investigation-video-webview.txt）：通用内嵌播放需新原生依赖（破零编辑铁律，否）；但同一官方 CSP webview 管线实测可播 **data: URI 视频**（手势后完整播放）。裁定：主案维持"信息卡+下载/分享→外部播放器"；本卡为 P2 增强，排全队列最后，**时间不允许则不做，不算欠账**。

## 设计裁定

- 阈值：≤8MB 视频走内嵌（FileHtmlPreview 同款管线+内联字节 data URI，mime 按扩展名）；>8MB 维持信息卡
- 复用 C6 previewKind 分派，新增 videoInline 桶；加载态+失败回退信息卡

## 范围

- 动：`(detail)/preview.tsx`、`src/shell/files/preview-kind.ts`(+test)、locales
- 不动：官方文件

## 验收

四项契约按卡裁剪：previewKind 边界单测（阈值/mime/失败回退）+真机 clip.mp4 内嵌播放实拍+大视频回退实拍。
