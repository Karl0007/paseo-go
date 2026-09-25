// 快捷指令表单校验 (card C7): the form screen's whole validation contract in one
// pure function — 名称必填, prompt 必填, host 必填 (DESIGN §5 / C7 card), everything
// else optional. Returns trimmed values (what gets stored) plus per-field error keys
// so the screen renders messages through i18n and the unit tests pin the rules
// without React.
import type { ShellCommandInput } from "@/shell/stores/commands";

export interface CommandFormValues {
  name: string;
  hostId: string;
  workspaceId: string | null;
  providerModel: string | null;
  prompt: string;
}

export type CommandFormErrorKey = "nameRequired" | "hostRequired" | "promptRequired";

export type CommandFormValidation =
  | { ok: true; value: ShellCommandInput }
  | { ok: false; errors: Partial<Record<keyof CommandFormValues, CommandFormErrorKey>> };

export function validateCommandForm(values: CommandFormValues): CommandFormValidation {
  const name = values.name.trim();
  const hostId = values.hostId.trim();
  const prompt = values.prompt.trim();
  const workspaceId = values.workspaceId?.trim() || null;
  const providerModel = values.providerModel?.trim() || null;

  const errors: Partial<Record<keyof CommandFormValues, CommandFormErrorKey>> = {};
  if (name === "") errors.name = "nameRequired";
  if (hostId === "") errors.hostId = "hostRequired";
  if (prompt === "") errors.prompt = "promptRequired";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      hostId,
      prompt,
      ...(workspaceId ? { workspaceId } : {}),
      ...(providerModel ? { providerModel } : {}),
    },
  };
}
