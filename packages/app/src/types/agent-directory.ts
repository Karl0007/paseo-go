import type { Agent } from "@/stores/session-store";

export type AgentDirectoryEntry = Pick<
  Agent,
  | "id"
  | "serverId"
  | "title"
  | "status"
  | "turn"
  | "lastActivityAt"
  | "cwd"
  | "workspaceId"
  | "provider"
  | "requiresAttention"
  | "attentionReason"
  | "attentionTimestamp"
  | "archivedAt"
  | "createdAt"
  | "labels"
  | "projectPlacement"
  // COMPAT(agentLastMessagePreview): Paseo Go B4-ROW — the shell chat row's
  // subtitle reads the last-message pair off the directory entry.
  | "lastMessagePreview"
  | "lastMessageRole"
  // COMPAT(agentOwnership): Paseo Go B4-OWNERSHIP — the shell's 「外部」 badge and
  // R4 send guard read the ownership pair off the directory entry.
  | "ownership"
  | "externalLooksActive"
> & {
  pendingPermissionCount?: number;
};
