// 快捷指令执行编排 (card C7): the screen-side state machine the 工作区 tab hosts.
// One instance serves every ⚡ row: `runningId` gates re-entry (the row's spinner +
// the hard guard against double-taps creating two agents), and a tap whose command
// has no workspace binding opens the official-sheet workspace picker instead of
// running — the picker's answer is what finally reaches the action layer.
import { useCallback, useState } from "react";
import type { ShellCommand } from "@/shell/stores/commands";
import { useShellCommandActions } from "./shellCommandActions";

export interface ShellCommandRunner {
  runningId: string | null;
  /** Command awaiting its 项目选择 sheet; null = sheet closed. */
  pickerCommand: ShellCommand | null;
  requestRun: (command: ShellCommand) => void;
  selectWorkspace: (workspaceId: string) => void;
  closePicker: () => void;
  remove: (command: ShellCommand) => Promise<void>;
}

export function useShellCommandRunner(): ShellCommandRunner {
  const actions = useShellCommandActions();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [pickerCommand, setPickerCommand] = useState<ShellCommand | null>(null);

  const runGuarded = useCallback(
    async (command: ShellCommand, workspaceId: string) => {
      // 防重复点击: a second tap while a createAgent is in flight is a no-op —
      // two taps must never mint two agents for one command.
      if (runningId !== null) return;
      setRunningId(command.id);
      try {
        await actions.run(command, workspaceId);
      } finally {
        setRunningId(null);
      }
    },
    [actions, runningId],
  );

  const requestRun = useCallback(
    (command: ShellCommand) => {
      if (command.workspaceId) {
        void runGuarded(command, command.workspaceId);
        return;
      }
      setPickerCommand(command);
    },
    [runGuarded],
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      const command = pickerCommand;
      setPickerCommand(null);
      if (command) void runGuarded(command, workspaceId);
    },
    [pickerCommand, runGuarded],
  );

  const closePicker = useCallback(() => setPickerCommand(null), []);

  return {
    runningId,
    pickerCommand,
    requestRun,
    selectWorkspace,
    closePicker,
    remove: (command) => actions.remove(command),
  };
}
