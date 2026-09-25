// Shared query normalisation for the shell's two search modes (card C9): one
// casefold rule so 对话过滤 and 文件名搜索 never diverge on what “matches” means.
// The empty query means “no filter” everywhere downstream.

/** Trim + casefold (CJK passes through untouched; toLowerCase is locale-free). */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}
