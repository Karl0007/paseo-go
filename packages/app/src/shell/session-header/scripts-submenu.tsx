// C21 运行脚本 subpage — the capsule-menu sibling of the official
// WorkspaceScriptsButton dropdown. Data source is the same workspace descriptor
// (`sessions[serverId].workspaces[...].scripts`, live over the WS update stream);
// execution is the same pair of client RPCs the official button fires:
// start = `client.startWorkspaceScript(workspaceId, scriptName)`, stop =
// `client.killTerminal(script.terminalId)` (the official stop path — there is no
// separate script.stop call). Rows keep the menu open (`closeOnSelect={false}`)
// so a second script is one tap away, and the descriptor round-trip is what
// flips a row's lifecycle label — no optimistic state here.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { Play, Square } from "lucide-react-native";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

const ThemedPlay = withUnistyles(Play, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedSquare = withUnistyles(Square, (theme) => ({ color: theme.colors.foregroundMuted }));

// Hoisted row marks (the header-menu MENU_*_ICON pattern): a JSX literal in an
// attribute would re-allocate the element per render (react-perf lint).
const SCRIPT_RUNNING_ICON = <ThemedSquare size={14} />;
const SCRIPT_STOPPED_ICON = <ThemedPlay size={14} />;

type ScriptEntry = WorkspaceDescriptor["scripts"][number];

interface ScriptRowProps {
  script: ScriptEntry;
  isPending: boolean;
  onToggle: (script: ScriptEntry) => void;
}

// Row/Inner split (the ChatListRow pattern): the handler binds the script
// inside a stable callback instead of an inline arrow in the JSX slot.
function ScriptRow({ script, isPending, onToggle }: ScriptRowProps) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const running = script.lifecycle === "running";
  const handleSelect = useCallback(() => {
    onToggle(script);
  }, [onToggle, script]);
  return (
    <ContextMenuItem
      leading={running ? SCRIPT_RUNNING_ICON : SCRIPT_STOPPED_ICON}
      description={t(running ? "header.scriptRunning" : "header.scriptStopped")}
      status={isPending ? "pending" : "idle"}
      closeOnSelect={false}
      onSelect={handleSelect}
      testID={`shell-session-menu-script-${script.scriptName}`}
    >
      {script.scriptName}
    </ContextMenuItem>
  );
}

export function SessionHeaderScriptsPage({
  serverId,
  workspaceId,
  scripts,
}: {
  serverId: string;
  workspaceId: string;
  scripts: readonly ScriptEntry[];
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [pendingName, setPendingName] = useState<string | null>(null);

  const toggleScript = useCallback(
    async (script: ScriptEntry) => {
      if (!client) {
        toast.show(t("header.scriptsNoClient"), { variant: "error" });
        return;
      }
      setPendingName(script.scriptName);
      try {
        if (script.lifecycle === "running") {
          if (!script.terminalId) {
            throw new Error(t("header.scriptStopFailed", { scriptName: script.scriptName }));
          }
          const result = await client.killTerminal(script.terminalId);
          if (!result.success) {
            throw new Error(t("header.scriptStopFailed", { scriptName: script.scriptName }));
          }
        } else {
          const result = await client.startWorkspaceScript(workspaceId, script.scriptName);
          if (result.error) {
            throw new Error(result.error);
          }
        }
      } catch (error) {
        toast.show(
          error instanceof Error
            ? error.message
            : t("header.scriptStartFailed", { scriptName: script.scriptName }),
          { variant: "error" },
        );
      } finally {
        setPendingName(null);
      }
    },
    [client, t, toast, workspaceId],
  );

  return (
    <>
      {scripts.map((script) => (
        <ScriptRow
          key={script.scriptName}
          script={script}
          isPending={pendingName === script.scriptName}
          onToggle={toggleScript}
        />
      ))}
    </>
  );
}
