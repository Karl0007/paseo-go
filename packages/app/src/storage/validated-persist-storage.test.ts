import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StateStorage, StorageValue } from "zustand/middleware";
import { createValidatedPersistStorage } from "./validated-persist-storage";

class MemoryStorage implements StateStorage {
  readonly values = new Map<string, string>();

  getItem(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeItem(name: string): void {
    this.values.delete(name);
  }
}

const StateSchema = z.strictObject({ enabled: z.boolean() });
// Deliberately schema-invalid payloads are TYPE-invalid too — the point of the
// suite is the runtime gate, so the poison enters through the untrusted edge.
type SettingsValue = StorageValue<{ enabled: boolean }>;

// R2-13: neither side may destroy data it cannot validate. A rejected read hydrates
// nothing (falsy = "never persisted" for zustand) but keeps the bytes; a rejected
// write skips THIS write and keeps the previous accepted copy. The whole-store
// eviction (removeItem on any failure) was the evaporation surface R2-14 rode in on.
describe("createValidatedPersistStorage", () => {
  it.each([
    ["malformed JSON", "{"],
    ["invalid state", JSON.stringify({ state: { enabled: "yes" }, version: 1 })],
    ["unknown state fields", JSON.stringify({ state: { enabled: true, extra: true }, version: 1 })],
    [
      "unknown envelope fields",
      JSON.stringify({ state: { enabled: true }, version: 1, extra: true }),
    ],
  ])("keeps %s untouched and hydrates nothing", async (_label, stored) => {
    const backing = new MemoryStorage();
    backing.values.set("settings", stored);
    const storage = createValidatedPersistStorage(backing, StateSchema);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Falsy (null/undefined) = "no persisted state" — the store starts fresh while
    // the first accepted write replaces the bytes. The raw copy must survive.
    await expect(storage.getItem("settings")).resolves.toBeNull();
    expect(backing.values.get("settings")).toBe(stored);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("returns schema-validated state", async () => {
    const backing = new MemoryStorage();
    backing.values.set("settings", JSON.stringify({ state: { enabled: true }, version: 1 }));
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).resolves.toEqual({
      state: { enabled: true },
      version: 1,
    });
  });

  it("rejects a schema-invalid write and keeps the previous accepted copy", async () => {
    const backing = new MemoryStorage();
    const previous = JSON.stringify({ state: { count: 1 } });
    backing.values.set("settings", previous);
    const storage = createValidatedPersistStorage(
      backing,
      z.strictObject({ count: z.number().finite() }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await storage.setItem("settings", { state: { count: Number.NaN } });

    // The NaN write is dropped; the old compliant value stays readable.
    expect(backing.values.get("settings")).toBe(previous);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    await expect(storage.getItem("settings")).resolves.toEqual({ state: { count: 1 } });
  });

  it("rejects a schema-invalid write on a cold name without creating bytes", async () => {
    const backing = new MemoryStorage();
    const storage = createValidatedPersistStorage(backing, StateSchema);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await storage.setItem("settings", { state: { enabled: "yes" } } as unknown as SettingsValue);

    expect(backing.values.has("settings")).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("writes an accepted value through", async () => {
    const backing = new MemoryStorage();
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await storage.setItem("settings", { state: { enabled: true }, version: 1 });

    expect(JSON.parse(backing.values.get("settings") ?? "null")).toEqual({
      state: { enabled: true },
      version: 1,
    });
  });

  it("a tampered envelope never evicts: old compliant data reads back after a failed cycle", async () => {
    const backing = new MemoryStorage();
    const good = JSON.stringify({ state: { enabled: true } });
    backing.values.set("settings", good);
    const storage = createValidatedPersistStorage(backing, StateSchema);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Simulate the R2-14 chain: a poisoned write is rejected, then the next read
    // still returns the last accepted state — no hydration from nothing.
    await storage.setItem("settings", {
      state: { enabled: "poisoned" },
    } as unknown as SettingsValue);
    await expect(storage.getItem("settings")).resolves.toEqual({ state: { enabled: true } });

    // Even a foreign tamper of the stored bytes keeps them and hydrates nothing.
    backing.values.set("settings", '{"state":{"enabled":42}');
    await expect(storage.getItem("settings")).resolves.toBeNull();
    expect(backing.values.get("settings")).toBe('{"state":{"enabled":42}');
    warn.mockRestore();
  });
});
