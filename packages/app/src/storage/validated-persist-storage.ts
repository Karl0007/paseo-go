import { z } from "zod";
import type { PersistStorage, StateStorage } from "zustand/middleware";

export function createValidatedPersistStorage<State>(
  backingStorage: StateStorage,
  stateSchema: z.ZodType<State>,
): PersistStorage<State> {
  const envelopeSchema = z.strictObject({
    state: stateSchema,
    version: z.number().int().nonnegative().optional(),
  });

  return {
    getItem: async (name) => {
      const raw = await backingStorage.getItem(name);
      if (raw === null) return null;

      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        await backingStorage.removeItem(name);
        return null;
      }

      const result = envelopeSchema.safeParse(decoded);
      if (!result.success) {
        await backingStorage.removeItem(name);
        return null;
      }
      return result.data;
    },
    setItem: async (name, value) => {
      const result = envelopeSchema.safeParse(value);
      if (!result.success) {
        // R2-13 (warn half only): this drop used to be silent, which hid
        // R2-14's NaN-driven whole-store eviction. Log it; the removeItem
        // behaviour itself is still R2-13's pending ruling — unchanged here.
        console.warn(
          "[validatedPersistStorage] setItem rejected by schema; dropped persisted copy",
          {
            name,
            issues: result.error.issues.map((issue) => issue.path.join(".") + ": " + issue.code),
          },
        );
        await backingStorage.removeItem(name);
        return;
      }
      await backingStorage.setItem(name, JSON.stringify(result.data));
    },
    removeItem: (name) => backingStorage.removeItem(name),
  };
}
