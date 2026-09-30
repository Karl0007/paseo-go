// B4-IMPORT（批次四 F7 裁定 12）：导入屏「已归档」徽标行点行主体 = 跳对话 tab
// 并切到已归档筛选。目标 filter 以模块级一次性意图（one-shot intent）投递，
// 不用路由参数——宽屏的 ChatsScreenBody 挂在 split 左栏（每个 navigator 之外，
// chats.tsx 头注同款论证），params 到不了它；这里与 section-focus/rail-events
// 同构：React-free、可单测、body 双位置都收得到。
//
// R4-17（裁定 12 补全「高亮该行」子句）：意图从裸 filter 扩为对象——已归档徽标
// 跳转带上目标 agent key（`${serverId}:${agentId}`，与 readState/pins 行键同形），
// body 消费端据此切页后把该行标成一次性高亮（use-chats-filter-jump）。不带
// highlightKey 的纯切页意图（若有）行为与旧契约一致。
//
// 一次性语义：request 写入 pending 并即时广播；body 订阅回调与**挂载时**都调
// consume——body 尚未挂载（深链直达导入屏、宽屏 section 首次访问前）时意图不丢，
// 挂载即兑现；兑现即清空，之后的手动切页/回访不再被旧意图覆写。
export type ChatsFilterName = "active" | "archived";

export interface ChatsFilterIntent {
  filter: ChatsFilterName;
  /** 跳转来源要高亮的行键（`serverId:agentId`）；缺省=只切页不高亮。 */
  highlightKey?: string;
}

let pending: ChatsFilterIntent | null = null;
const listeners = new Set<() => void>();

export function requestChatsFilter(intent: ChatsFilterIntent): void {
  pending = intent;
  // Set 迭代 delete-safe（退订中的监听器被跳过）、mid-beat 订阅者同拍收到——
  // body 挂载撞上广播正是想要的，emitSectionFocus 同纪律。
  for (const listener of listeners) listener();
}

export function consumeChatsFilterIntent(): ChatsFilterIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}

export function subscribeChatsFilterIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
