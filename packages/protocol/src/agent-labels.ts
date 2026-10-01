export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
export const IMPORTED_PROVIDER_SESSION_LABEL = "paseo.imported-provider-session";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function isImportedProviderSession(agent: AgentLabelSource): boolean {
  return agent.labels?.[IMPORTED_PROVIDER_SESSION_LABEL] === "true";
}

/**
 * How a session came to live in the daemon's storage (Paseo Go B6-OWN-HEAL, batch-6
 * F19/D22 — the pill's 「原生还是非原生」 question when no live writer is in evidence):
 * `launch` = a daemon provider process created it; `import` = the import screen
 * adopted a session the user had been continuing in a terminal.
 */
export type AgentOrigin = "launch" | "import";

/**
 * The birth axis, read off the ONE provenance stamp the daemon owns — C22's import
 * choke point (`IMPORTED_PROVIDER_SESSION_LABEL`, backfilled on re-import). Nothing
 * new is persisted, so every record answers. The honest limit: a session adopted
 * before that stamp existed is indistinguishable from a launched one and answers
 * `launch`; clients keep their own 「unknown」 for the case they CAN detect — a daemon
 * that never reports the axis (`origin` absent).
 */
export function deriveAgentOrigin(agent: AgentLabelSource): AgentOrigin {
  return isImportedProviderSession(agent) ? "import" : "launch";
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}
