// R4-17（B4-IMPORT 裁定 12 的「高亮该行」子句补全）：导入屏「已归档」徽标跳转
// 的消费端。意图总线（filter-request）只送到「切到哪页 + 标哪个行」；这里把它
// 兑现成 body 的两件可观察事实：
//
// 1. filter 切换——经由 body 传进来的同一个 setFilter（segment 点击/横滑切页也
//    是它），绝不另立第二份页状态。
// 2. 一次性高亮 + 视口归位——官方 DraggableList 包装不透出 scroll ref（chats 屏
//    头注实证），本列表唯一免 ref 的滚动原语就是换 key 重挂到顶（rail 重复点
//    回顶同款）。所以跳转把 nonce +1（body 折进 list key = 新视口在列表顶部），
//    并把行键标成高亮；1.2s 后自动熄灭（一次性：回访/手动切页不再被旧高亮
//    覆写，与总线的 consume-once 同律）。高亮本体复用 C31 行 `selected` 样式
//    （chat-list-row 既有 prop，零新组件零新样式面）。
//
// nonce 只增不减且高亮熄灭不碰它——否则 extraData 之外的 key 抖动会把列表在
// 动画收尾时再重挂一次（B4-REGRESS 重挂面纪律）。
import { useEffect, useState } from "react";
import {
  consumeChatsFilterIntent,
  subscribeChatsFilterIntent,
  type ChatsFilterName,
} from "./filter-request";

/** 高亮脉冲时长：够看见、够短到不打扰第二次操作。 */
export const CHATS_JUMP_HIGHLIGHT_MS = 1200;

export interface ChatsFilterJump {
  /** 当前被标的行键（`serverId:agentId`）；null=无高亮。 */
  highlightKey: string | null;
  /** 跳转重挂计数：body 折进 DraggableList 的 key（免 ref 的归顶原语）。 */
  nonce: number;
}

const IDLE: ChatsFilterJump = { highlightKey: null, nonce: 0 };

export function useChatsFilterJump(
  applyFilter: (filter: ChatsFilterName) => void,
): ChatsFilterJump {
  const [jump, setJump] = useState<ChatsFilterJump>(IDLE);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const intent = consumeChatsFilterIntent();
      if (!intent) return;
      applyFilter(intent.filter);
      if (!intent.highlightKey) return;
      const highlightKey = intent.highlightKey;
      setJump((prev) => ({ highlightKey, nonce: prev.nonce + 1 }));
      clearTimeout(timer);
      timer = setTimeout(
        // nonce 原样保留：熄灭只是行样式，不是重挂。
        () => setJump((prev) => ({ ...prev, highlightKey: null })),
        CHATS_JUMP_HIGHLIGHT_MS,
      );
    };
    apply();
    const off = subscribeChatsFilterIntent(apply);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [applyFilter]);
  return jump;
}
