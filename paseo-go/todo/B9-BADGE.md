# B9-BADGE 未读角标统一移行右缘（F32）

## 口径（用户截图钉死）

现状=未读计数圆标「1」在时间**左侧**（titleTrailing 组 spinner→badge→time），行最右另有未读点——两处分居。裁定：**未读指示统一收进行右缘唯一槽位（时间右侧）**：count>1 显计数圆标，否则显点；一行只出现一枚。子 agent 徽标（B9-SUBACT 的「子任务×N」）将复用此右缘槽位家族同款样式（圆/同尺寸/同色系纪律）。

## 文件域

`shell/components/chat-list-row.tsx`(+test)、必要时 chats-screen-body 传参。非目标=导入屏（B9Title 在途域）、pill、手势、服务端。

## 验收

测：右缘顺序断言（spinner→time→badge 槽）、count/dot 互斥单枚、长标题下右缘组不挤时间；真机帧：有未读的行角标在时间右缘、行最右无第二枚；scoped components 绿+typecheck+oxlint。**恰好一次 commit**（令牌制）。
