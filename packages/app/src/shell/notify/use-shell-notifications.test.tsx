// R2-08① regression: 壳归档 must mute the notification pipeline. The hook already
// honored the SERVER-side archivedAt flag; the local archive store (the key the 对话
// tab hides rows by) was invisible here — an archived agent entering needs_input
// still fired a system notification. Baseline: both agents notify (2 calls). Fixed:
// only the live one does.
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: async (key: string) => {
        storage.delete(key);
      },
    },
  };
});

const h = vi.hoisted(() => ({
  agents: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/use-aggregated-agents", () => ({
  useAggregatedAgents: () => ({ agents: h.agents, isLoading: false }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "s1" }],
  useHostRegistryStatus: () => "ready",
}));

vi.mock("./service", () => ({
  startShellNotifyService: vi.fn(),
  postAttentionNotification: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // @/i18n/i18next wires the real instance through this plugin at import time.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";

import { usePaseoGoSettingsStore } from "@/shell/stores/settings";
import { postAttentionNotification } from "./service";
import { useShellNotifications } from "./use-shell-notifications";

function directoryAgent(id: string, needsInput: boolean): Record<string, unknown> {
  return {
    serverId: "s1",
    id,
    workspaceId: null,
    title: id,
    status: needsInput ? "idle" : "running",
    requiresAttention: needsInput,
    attentionReason: needsInput ? "permission" : null,
    pendingPermissionCount: 0,
    attentionTimestamp: needsInput ? new Date(1_000) : null,
    lastActivityAt: new Date(2_000),
    archivedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePaseoGoArchiveStore.setState({ archivedIds: [] });
  usePaseoGoSettingsStore.setState({ notifications: true });
});

describe("useShellNotifications × 壳归档 (R2-08①)", () => {
  it("mutes archived rows: only the live agent's transition notifies", () => {
    usePaseoGoArchiveStore.getState().archive("s1:a1");
    h.agents = [directoryAgent("a1", false), directoryAgent("a2", false)];
    const { rerender } = renderHook(() => useShellNotifications());

    // Both flip to needs_input; a1 is 壳归档 → silent, a2 fires.
    h.agents = [directoryAgent("a1", true), directoryAgent("a2", true)];
    act(() => rerender());

    const calls = vi.mocked(postAttentionNotification).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]?.payload).toMatchObject({ serverId: "s1", agentId: "a2" });
  });
});
