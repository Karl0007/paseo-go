// C7 acceptance: 表单校验 — 名称/prompt/主机必填、其余可空（每次问/默认），trim 进
// 存储值，可空字段以 absent 而非 null 交付 store。
import { describe, expect, it } from "vitest";
import { validateCommandForm, type CommandFormValues } from "./validate";

const valid: CommandFormValues = {
  name: "列出目录结构",
  hostId: "srv-A",
  workspaceId: null,
  providerModel: null,
  prompt: "列出当前目录结构",
};

describe("validateCommandForm", () => {
  it("accepts the minimal 名称+主机+prompt shape and trims into the stored value", () => {
    const result = validateCommandForm({
      ...valid,
      name: "  列出目录结构  ",
      prompt: "  列出当前目录结构\n ",
    });
    expect(result).toEqual({
      ok: true,
      value: { name: "列出目录结构", hostId: "srv-A", prompt: "列出当前目录结构" },
    });
  });

  it("keeps optional selections only when non-blank", () => {
    const result = validateCommandForm({
      ...valid,
      workspaceId: "ws-1",
      providerModel: "  ",
    });
    expect(result.ok && result.value).toEqual({
      name: "列出目录结构",
      hostId: "srv-A",
      prompt: "列出当前目录结构",
      workspaceId: "ws-1",
    });
  });

  it("reports every missing required field at once", () => {
    const result = validateCommandForm({
      name: "   ",
      hostId: "",
      workspaceId: null,
      providerModel: null,
      prompt: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual({
        name: "nameRequired",
        hostId: "hostRequired",
        prompt: "promptRequired",
      });
    }
  });
});
