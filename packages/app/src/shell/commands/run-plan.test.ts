// C7 acceptance: 执行参数组装 — the two ruled failure gates (host 离线拒绝, and the
// workspaceId-缺省 path where the picker's answer is what gets assembled), plus the
// provider default order (command > form preferences > first ready provider > named
// failure) and the provider/model split feeding createAgent's config.
import { describe, expect, it } from "vitest";
import { resolveCommandRunPlan, splitProviderModel } from "./run-plan";

const runnable = {
  clientAvailable: true,
  workspaceDirectory: "C:/tmp/c5-proj",
  prompt: "列出当前目录结构",
  workspaceId: "ws-1",
  clientMessageId: "cm-1",
  preferredProvider: null,
  availableProviders: ["claude", "codex"],
};

describe("splitProviderModel", () => {
  it("splits at the first slash, keeps bare providers whole", () => {
    expect(splitProviderModel("codex/gpt-5")).toEqual({ provider: "codex", model: "gpt-5" });
    expect(splitProviderModel("codex")).toEqual({ provider: "codex" });
    expect(splitProviderModel("openrouter/deepseek/r1")).toEqual({
      provider: "openrouter",
      model: "deepseek/r1",
    });
    expect(splitProviderModel("  ")).toBeNull();
    expect(splitProviderModel("/gpt-5")).toBeNull();
    expect(splitProviderModel(null)).toBeNull();
  });
});

describe("resolveCommandRunPlan", () => {
  it("refuses while the host has no live client — offline never queues a request", () => {
    expect(resolveCommandRunPlan({ ...runnable, clientAvailable: false })).toEqual({
      ok: false,
      error: "offline",
    });
  });

  it("refuses when the workspace descriptor has not synced (no cwd to run in)", () => {
    expect(resolveCommandRunPlan({ ...runnable, workspaceDirectory: null })).toEqual({
      ok: false,
      error: "workspaceNotSynced",
    });
  });

  it("assembles the createAgent request for a bound command", () => {
    const plan = resolveCommandRunPlan({ ...runnable, providerModel: "codex/gpt-5" });
    expect(plan).toEqual({
      ok: true,
      request: {
        config: { provider: "codex", cwd: "C:/tmp/c5-proj", model: "gpt-5" },
        workspaceId: "ws-1",
        initialPrompt: "列出当前目录结构",
        clientMessageId: "cm-1",
      },
    });
  });

  it("runs the workspaceId-缺省 path on the picker's answer", () => {
    // The command carries no workspaceId; the sheet's choice is what the plan — and
    // only the plan — puts into the request.
    const plan = resolveCommandRunPlan({
      ...runnable,
      workspaceId: "ws-picked",
      providerModel: "claude",
    });
    expect(plan.ok && plan.request.workspaceId).toBe("ws-picked");
    expect(plan.ok && plan.request.config).toEqual({
      provider: "claude",
      cwd: "C:/tmp/c5-proj",
    });
  });

  it("resolves the default model: form preferences first, then the first ready provider", () => {
    const withPrefs = resolveCommandRunPlan({ ...runnable, preferredProvider: "codex" });
    expect(withPrefs.ok && withPrefs.request.config.provider).toBe("codex");
    const withoutPrefs = resolveCommandRunPlan({ ...runnable, preferredProvider: "  " });
    expect(withoutPrefs.ok && withoutPrefs.request.config.provider).toBe("claude");
  });

  it("names the failure when no provider can be resolved at all", () => {
    expect(
      resolveCommandRunPlan({ ...runnable, availableProviders: [], preferredProvider: null }),
    ).toEqual({ ok: false, error: "noProvider" });
  });
});
