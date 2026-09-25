// 对话搜索 (card C9, DESIGN §4/§8): pure instant-filter helpers for the 对话 tab.
// The query is matched case-insensitively against the four fields the row shows
// or implies — shell alias (pins.aliases), official title, project name, and the
// localised 最后动态 label — so filtering needs no React and the screen just
// supplies the haystack. Grouping is preserved: 置顶 hits stay in the 置顶 group;
// only the lone-最近 header rule is recomputed after filtering (a 最近 group that
// ends up on top still hides its header, matching derive's rule).
import type { ChatAgentInput, ChatSection } from "@/shell/chats/derive";

/** The row's searchable texts; null/undefined fields never match. */
export interface ChatSearchFields {
  /** Shell-local rename (pins store). Wins over the official title. */
  alias: string | null | undefined;
  title: string | null | undefined;
  projectName: string | null | undefined;
  /** Translated 最后动态 label (running / waiting / finished / failed); null = none. */
  activityLabel: string | null | undefined;
}

/** Case-insensitive substring test against one row's haystack. `normalizedQuery`
 * comes from `normalizeSearchQuery`; the empty query matches everything. */
export function chatMatchesQuery(fields: ChatSearchFields, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true;
  return [fields.alias, fields.title, fields.projectName, fields.activityLabel].some(
    (haystack) => typeof haystack === "string" && haystack.toLowerCase().includes(normalizedQuery),
  );
}

/**
 * Keep only sections with matching rows; rows keep their group and order.
 * `matches` receives the derivation input (the screen closes over the haystack).
 */
export function filterChatSections<T extends ChatAgentInput>(
  sections: readonly ChatSection<T>[],
  matches: (agent: T) => boolean,
): ChatSection<T>[] {
  const kept: ChatSection<T>[] = [];
  for (const section of sections) {
    const rows = section.rows.filter((row) => matches(row.agent));
    if (rows.length === 0) continue;
    kept.push({ ...section, rows });
  }
  // deriveChatSections hides a 最近 header only when nothing outranks it above;
  // filtering can promote 最近 to first, which is the only case that needs the
  // rule re-applied (a later 最近 already carries showHeader: true from derive).
  const head = kept[0];
  if (head && head.kind === "recent" && head.showHeader) {
    kept[0] = { ...head, showHeader: false };
  }
  return kept;
}
