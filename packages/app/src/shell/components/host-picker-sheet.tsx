// KI-5: 导入屏顶栏主机 chip 的主机列表 sheet。裁定=点击 chip 必弹主机列表（不再走
// 官方 useHostChooser 的单主机静默自动选中捷径），列表末尾恒有「添加主机」行——
// 单主机态下这行是本屏唯一的加机入口。呈现复用官方菜单引擎的 sheet 形态
// （同 command-workspace-picker：受控 open + 隐藏 trigger，由屏拥有开关；勿自造 Modal）。
// 行序复用官方 orderHostsLocalFirst；leading 复用官方 HostStatusDotSlot。
import { useCallback, useMemo, type ReactElement } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HostStatusDotSlot } from "@/components/hosts/host-picker";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { orderHostsLocalFirst, type HostProfile } from "@/types/host-connection";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

const ThemedPlus = withUnistyles(Plus, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

// Icon through a helper so no JSX crosses a prop boundary per render (file-action-menu).
function addHostLeading(): ReactElement {
  return <ThemedPlus size={16} />;
}

function hostLeading(serverId: string): ReactElement {
  return <HostStatusDotSlot serverId={serverId} />;
}

// Stable-handler rows (chat-row-menu pattern): the engine takes selection through
// `selectItem`, so the sheet's rows must not rebuild closures per parent render.
function HostPickRow({
  host,
  currentServerId,
  choose,
}: {
  host: HostProfile;
  currentServerId: string | null;
  choose: (serverId: string) => void;
}): ReactElement {
  const onSelect = useCallback(() => choose(host.serverId), [choose, host.serverId]);
  return (
    <DropdownMenuItem
      leading={hostLeading(host.serverId)}
      description={host.serverId}
      selected={host.serverId === currentServerId}
      onSelect={onSelect}
      testID={`shell-host-pick-${host.serverId}`}
    >
      {host.label}
    </DropdownMenuItem>
  );
}

function AddHostRow({ label, add }: { label: string; add: () => void }): ReactElement {
  const onSelect = useCallback(() => add(), [add]);
  return (
    <DropdownMenuItem leading={addHostLeading()} onSelect={onSelect} testID="shell-host-pick-add">
      {label}
    </DropdownMenuItem>
  );
}

export function ShellHostPickerSheet({
  open,
  hosts,
  currentServerId,
  onPick,
  onAddHost,
  onClose,
}: {
  open: boolean;
  hosts: HostProfile[];
  currentServerId: string | null;
  onPick: (serverId: string) => void;
  onAddHost: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const localServerId = useLocalDaemonServerId();
  const orderedHosts = useMemo(
    () => orderHostsLocalFirst(hosts, localServerId),
    [hosts, localServerId],
  );
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={handleOpenChange}>
      {/* The sheet is opened by the screen's host chip, never by pressing this anchor. */}
      <DropdownMenuTrigger
        testID="shell-host-picker-trigger"
        accessibilityRole="button"
        style={styles.hiddenTrigger}
      >
        {null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sheetTitle={t("import.chooseHost")}
        width={280}
        testID="shell-host-picker"
      >
        {orderedHosts.map((host) => (
          <HostPickRow
            key={host.serverId}
            host={host}
            currentServerId={currentServerId}
            choose={onPick}
          />
        ))}
        <AddHostRow label={t("import.addHost")} add={onAddHost} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create(() => ({
  hiddenTrigger: {
    width: 0,
    height: 0,
    overflow: "hidden",
  },
}));
