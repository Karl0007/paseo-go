// C12 acceptance (双语完备): zh/en are the shell's only two bundles (DESIGN.md §2.4),
// so a key present in one language but absent in the other silently renders the raw
// key or the fallback language on real devices. i18next plural resolution makes this
// easy to introduce: `t(k, { count })` looks up `k_one`/`k_other` per-locale, and a
// hand-added non-suffixed key "works" in zh via non-explicit fallback while en misses
// it entirely. The guard is therefore literal deep-key equality (no plural
// normalisation) plus per-key interpolation-placeholder equality.
import { describe, expect, it } from "vitest";
import en from "./en.json";
import zh from "./zh.json";

function flattenKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

function collectPlaceholders(node: unknown, prefix = ""): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (typeof node === "string") out.set(prefix, placeholders(node));
  else if (node !== null && typeof node === "object")
    for (const [k, v] of Object.entries(node as Record<string, unknown>))
      for (const [key, ph] of collectPlaceholders(v, prefix ? `${prefix}.${k}` : k))
        out.set(key, ph);
  return out;
}

describe("shell locales (zh/en)", () => {
  it("have exactly the same deep key set", () => {
    const zhKeys = new Set(flattenKeys(zh));
    const enKeys = new Set(flattenKeys(en));
    expect([...zhKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !zhKeys.has(k))).toEqual([]);
    // sanity: the guard actually sees the bundle
    expect(zhKeys.size).toBeGreaterThan(100);
  });

  it("use the same interpolation placeholders per key", () => {
    const zhPh = collectPlaceholders(zh);
    const enPh = collectPlaceholders(en);
    const mismatched = [...zhPh.keys()].filter(
      (k) => enPh.has(k) && JSON.stringify(zhPh.get(k)) !== JSON.stringify(enPh.get(k)),
    );
    expect(mismatched).toEqual([]);
  });
});
