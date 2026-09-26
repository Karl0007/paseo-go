import { describe, expect, test } from "vitest";
import {
  getParentAgentIdFromLabels,
  getOpenAgentTabLabel,
  hasOpenAgentTab,
  IMPORTED_PROVIDER_SESSION_LABEL,
  isDelegatedAgent,
  isImportedProviderSession,
  isOpenAgentTabLabel,
  PARENT_AGENT_ID_LABEL,
} from "./agent-labels.js";

describe("agent label policy", () => {
  test("treats a non-empty parent agent label as delegation", () => {
    const labels = { [PARENT_AGENT_ID_LABEL]: " parent-agent \n" };

    expect(getParentAgentIdFromLabels(labels)).toBe("parent-agent");
    expect(isDelegatedAgent({ labels })).toBe(true);
  });

  test("ignores missing, empty, and non-string parent agent labels", () => {
    expect(isDelegatedAgent({ labels: {} })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } })).toBe(false);
  });

  test("recognizes only a literal 'true' imported provider session label", () => {
    expect(
      isImportedProviderSession({ labels: { [IMPORTED_PROVIDER_SESSION_LABEL]: "true" } }),
    ).toBe(true);
    expect(isImportedProviderSession({ labels: {} })).toBe(false);
    expect(
      isImportedProviderSession({ labels: { [IMPORTED_PROVIDER_SESSION_LABEL]: "TRUE" } }),
    ).toBe(false);
    expect(isImportedProviderSession({ labels: { [IMPORTED_PROVIDER_SESSION_LABEL]: true } })).toBe(
      false,
    );
    expect(isImportedProviderSession({ labels: null })).toBe(false);
    expect(isImportedProviderSession({})).toBe(false);
  });

  test("treats any true client-scoped open-tab label as open", () => {
    const desktopLabel = getOpenAgentTabLabel("desktop-client");
    const mobileLabel = getOpenAgentTabLabel("mobile-client");

    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "true" })).toBe(true);
    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "false" })).toBe(false);
    expect(hasOpenAgentTab({})).toBe(false);
  });

  test("recognizes only client-scoped open-tab labels", () => {
    expect(isOpenAgentTabLabel(getOpenAgentTabLabel("client-a"))).toBe(true);
    expect(isOpenAgentTabLabel("paseo.open-agent-tab")).toBe(false);
    expect(isOpenAgentTabLabel("custom.open-agent-tab.client-a")).toBe(false);
  });
});
