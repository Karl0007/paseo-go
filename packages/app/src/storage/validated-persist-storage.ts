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
        // R2-13: an unparseable envelope is NOT removed. Falsy here means "nothing
        // persisted" to zustand's hydrate (it truthiness-checks the value), so the
        // store boots from its initial state while the bytes stay for diagnosis —
        // and the first accepted write replaces them. The old removeItem turned a
        // one-off corruption into permanent, silent whole-store loss.
        console.warn("[validatedPersistStorage] getItem: unparseable JSON; kept, not hydrated", {
          name,
        });
        return null;
      }

      const result = envelopeSchema.safeParse(decoded);
      if (!result.success) {
        console.warn("[validatedPersistStorage] getItem: rejected by schema; kept, not hydrated", {
          name,
          issues: result.error.issues.map((issue) => issue.path.join(".") + ": " + issue.code),
        });
        return null;
      }
      return result.data;
    },
    setItem: async (name, value) => {
      const result = envelopeSchema.safeParse(value);
      if (!result.success) {
        // R2-13: a poisoned write is skipped, the previously accepted copy stays
        // (removeItem here is what evicted whole stores when R2-14's NaN reached
        // the schema — the panel-store schema tombstones are that damage). The
        // live in-memory state is untouched either way; only this persist loses.
        console.warn("[validatedPersistStorage] setItem rejected by schema; previous copy kept", {
          name,
          issues: result.error.issues.map((issue) => issue.path.join(".") + ": " + issue.code),
        });
        return;
      }
      await backingStorage.setItem(name, JSON.stringify(result.data));
    },
    removeItem: (name) => backingStorage.removeItem(name),
  };
}
