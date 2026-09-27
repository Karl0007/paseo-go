import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createWorkspaceServiceRoutePreferencesStore } from "./store";

function createMemoryStorage(initial?: Record<string, string>): StateStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    values,
    getItem: async (name) => values.get(name) ?? null,
    setItem: async (name, value) => {
      values.set(name, value);
    },
    removeItem: async (name) => {
      values.delete(name);
    },
  };
}

describe("workspace service route preferences", () => {
  it("persists each host's preferred route", async () => {
    const storage = createMemoryStorage();
    const first = createWorkspaceServiceRoutePreferencesStore(storage);
    await first.persist.rehydrate();

    first.getState().setPreferredRoute("desktop", "direct");
    first.getState().setPreferredRoute("devbox", "public");

    const restored = createWorkspaceServiceRoutePreferencesStore(storage);
    await restored.persist.rehydrate();
    expect(restored.getState().byServerId).toEqual({ desktop: "direct", devbox: "public" });
  });

  it("keeps an invalid persisted value untouched and hydrates nothing", async () => {
    // R2-13: a rejected envelope is never evicted — the store boots from its
    // initial state (falsy read = nothing hydrated) while the bytes stay for
    // diagnosis until the first accepted write replaces them.
    const tampered = JSON.stringify({
      state: { byServerId: { desktop: "direct", broken: "unknown" } },
      version: 1,
    });
    const storage = createMemoryStorage({
      "workspace-service-route-preferences": tampered,
    });
    const store = createWorkspaceServiceRoutePreferencesStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().byServerId).toEqual({});
    expect(storage.values.get("workspace-service-route-preferences")).toBe(tampered);
  });
});
