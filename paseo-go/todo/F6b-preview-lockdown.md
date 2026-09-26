# F6b 预览兜底 root 封堵（REVIEW-FIX F6 移交仲裁，编排者已裁：修）

## 背景

REVIEW-FIX F6 真机实证：手拼深链的 serverId/workspaceId 解析不出 descriptor 时，走 `params.workspaceRoot` 兜底读出 win.ini。兜底无约束=残余攻击面。裁定：封堵，信任锚=用户自己创建的收藏快照。

## 设计裁定（照此执行）

`src/app/(detail)/preview.tsx` 的 root 解析改三级：①descriptor 命中→用 descriptor root（现行为）；②无 descriptor→`params.workspaceRoot+path` 必须**精确匹配某条 favorites 快照**（hostId 匹配 + workspaceRoot 相等 + path 在该快照条目所在目录树内即 `path` 的父目录链含收藏条目路径或等于收藏路径）→用收藏快照的 root+path；③都不匹配→拒读（notFound 态，不发起任何 daemon 请求）。收藏条目本就存了 workspaceRoot+path（favorites store 快照字段现成）。

## 范围

- 动：`preview.tsx`（解析函数抽出到 `src/shell/files/preview-root.ts`）、新单测、（如需）favorites store 只读 helper
- 不动：其它

## 验收

1. 门禁绿 2. 单测：descriptor 优先/收藏匹配放行/不匹配拒读/跨 host 匹配拒绝/路径前缀伪冒（favorite=/a/b.txt，深链 root=/a&path=../../windows/win.ini 类）全边界 3. 真机复验 REVIEW-FIX 的同款手拼链→拒读截图 1 张 4. 恰好一次 commit（detached 纪律）
