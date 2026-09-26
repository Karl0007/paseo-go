// 重命名屏 (card C33, DESIGN §14.3): the rename form moves out of the row/capsule
// menus' MenuTextField sub-page into its own hidden tab (files/commands/import
// pattern, C5 KI-2) — context menus become plain anchored popovers, renaming is a
// form page, like mainstream IM. Entry: 行长按菜单 / 胶囊 ⋯ → 重命名, both push
// shellRenameHref with the target's raw ids (object params). 保存 = the existing
// shellAgentActions.rename contract — a blank value clears the alias back to the
// daemon title (裁定 5 的「空提交=清除」is that contract, never re-implemented
// here); 返回/取消 = leave WITHOUT saving. The save/cancel wiring is the pure
// `createRenameScreenHandlers` (unit-tested); the screen keeps field state and the
// hidden-tab back (button and hardware both jump to the 对话 tab, never a stack pop).
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Platform, Pressable, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ChevronLeft } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { EditingTextInput } from "@/components/ui/text-input";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { SHELL_TAB } from "@/shell/routes";
import { usePaseoGoPinsStore } from "@/shell/stores/pins";
import {
  useShellAgentActions,
  type ShellAgentActions,
  type ShellChatTarget,
} from "@/shell/shellAgentActions";

/** Route params → action target. A push always carries both ids; anything less
 *  yields null and the screen shows chrome only (no form to act on). */
export function resolveRenameTarget(params: {
  serverId?: string | string[];
  agentId?: string | string[];
}): ShellChatTarget | null {
  const serverId = Array.isArray(params.serverId) ? params.serverId[0] : params.serverId;
  const agentId = Array.isArray(params.agentId) ? params.agentId[0] : params.agentId;
  if (!serverId || !agentId) return null;
  return { key: `${serverId}:${agentId}`, serverId, agentId };
}

/** The screen's save/cancel contract, React-free: 保存 hands the RAW value to
 *  `rename` (trim/blank-clears semantics live in shellAgentActions, already
 *  unit-tested) and leaves; 取消/返回 leaves without touching the store. */
export function createRenameScreenHandlers(deps: {
  target: ShellChatTarget;
  rename: ShellAgentActions["rename"];
  goBack: () => void;
}): { save: (value: string) => void; cancel: () => void } {
  return {
    save: (value) => {
      deps.rename(deps.target, value);
      deps.goBack();
    },
    cancel: deps.goBack,
  };
}

function RenameFormBody({
  target,
  alias,
  actions,
  goBack,
}: {
  target: ShellChatTarget;
  alias: string | undefined;
  actions: ShellAgentActions;
  goBack: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const rename = actions.rename;
  const handlers = useMemo(
    () => createRenameScreenHandlers({ target, rename, goBack }),
    [goBack, rename, target],
  );
  // The field is uncontrolled (EditingTextInput owns its editor); this mirrors it
  // for the save button, seeded from the live alias (commands/edit pattern).
  const [value, setValue] = useState(alias ?? "");
  const handleChange = useCallback((text: string) => setValue(text), []);
  const handleSave = useCallback(() => handlers.save(value), [handlers, value]);
  return (
    <View style={styles.body} testID={`shell-rename-form-${target.key}`}>
      <Text style={styles.fieldLabel}>{t("chats.rename.name")}</Text>
      <EditingTextInput
        initialValue={alias ?? ""}
        onChangeText={handleChange}
        placeholder={t("chats.rename.placeholder")}
        placeholderTextColor={styles.placeholder.color}
        accessibilityLabel={t("chats.rename.title")}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={handleSave}
        testID={`shell-rename-field-${target.key}`}
        style={styles.input}
      />
      <Text style={styles.hint}>{t("chats.rename.hint")}</Text>
      <Button variant="default" onPress={handleSave} testID={`shell-rename-save-${target.key}`}>
        {t("chats.rename.save")}
      </Button>
      <Button
        variant="ghost"
        onPress={handlers.cancel}
        testID={`shell-rename-cancel-${target.key}`}
      >
        {t("chats.rename.cancel")}
      </Button>
    </View>
  );
}

export default function ShellRenameScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ serverId?: string; agentId?: string }>();
  const target = useMemo(() => resolveRenameTarget(params), [params]);

  // The field seeds from the pins store — like commands/edit, the seed waits for
  // persist rehydration or 重命名 would open on an empty field.
  const [hydrated, setHydrated] = useState(() => usePaseoGoPinsStore.persist.hasHydrated());
  useEffect(() => usePaseoGoPinsStore.persist.onFinishHydration(() => setHydrated(true)), []);
  const alias = usePaseoGoPinsStore((state) => (target ? state.aliases[target.key] : undefined));
  const actions = useShellAgentActions();

  // 隐藏 tab 的返回 (files/import pattern): 返回/取消 both jump back to the 对话 tab
  // through the tab navigator — 不保存退出 (裁定 5). The hardware listener is
  // focus-scoped.
  const goBack = useCallback(
    () => navigation.navigate({ name: SHELL_TAB.chats } as never),
    [navigation],
  );
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [goBack]),
  );

  return (
    <View style={styles.screen} testID="shell-rename-screen">
      <View style={[styles.header, { paddingTop: insets.top + 8 }]} testID="shell-rename-header">
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t("header.back")}
          hitSlop={8}
          style={styles.back}
          testID="shell-rename-back"
        >
          <ChevronLeft size={22} color={styles.backIcon.color} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("chats.rename.title")}
        </Text>
      </View>
      {target && hydrated ? (
        <RenameFormBody target={target} alias={alias} actions={actions} goBack={goBack} />
      ) : (
        <View style={styles.skeleton} testID="shell-rename-skeleton">
          <View style={styles.skeletonLabel} />
          <View style={styles.skeletonBox} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  back: {
    padding: theme.spacing[1],
  },
  backIcon: {
    color: theme.colors.foreground,
  },
  headerTitle: {
    flex: 1,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  body: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  skeleton: {
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  skeletonLabel: {
    width: 96,
    height: 12,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  skeletonBox: {
    height: 44,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
}));
