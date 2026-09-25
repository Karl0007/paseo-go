// 顶栏搜索态 (card C9, DESIGN §4/§5): the header's search mode — a pill-styled
// input (the official SearchField chrome, rebuilt on EditingTextInput so it can
// take autoFocus, the command-center idiom) plus a 取消 button that leaves the
// mode. Keyboard avoidance rides the official facilities: KeyboardProvider
// (react-native-keyboard-controller) wraps the root stack and MainActivity runs
// adjustResize, so the anchored-to-top bar is never covered; 取消 also dismisses
// the keyboard explicitly. The input is uncontrolled (initialValue=""): leaving
// the mode unmounts it, re-entering starts clean — the parent owns `query`.
import { useCallback } from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Search } from "lucide-react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  // Placeholders sit at foregroundMuted and no dimmer — search-field.tsx §14.
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

// C12: 44dp cancel target (module const — react-perf forbids per-render objects).
const CANCEL_HIT_SLOP = { top: 10, bottom: 10, left: 6, right: 6 } as const;

export interface SearchModeBarProps {
  onQueryChange: (query: string) => void;
  onCancel: () => void;
  placeholder: string;
  inputTestID: string;
  cancelTestID: string;
}

export function SearchModeBar({
  onQueryChange,
  onCancel,
  placeholder,
  inputTestID,
  cancelTestID,
}: SearchModeBarProps) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const handleCancel = useCallback(() => {
    Keyboard.dismiss();
    onCancel();
  }, [onCancel]);
  const cancelStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.cancel, pressed && styles.cancelPressed],
    [],
  );
  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Search size={14} color={styles.iconColor.color} />
        <ThemedTextInput
          testID={inputTestID}
          initialValue=""
          onChangeText={onQueryChange}
          placeholder={placeholder}
          accessibilityLabel={placeholder}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
      </View>
      <Pressable
        onPress={handleCancel}
        accessibilityRole="button"
        hitSlop={CANCEL_HIT_SLOP}
        testID={cancelTestID}
        style={cancelStyle}
      >
        <Text style={styles.cancelText}>{t("search.cancel")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // SearchField's own pill: surface1 → surface2/borderAccent lives in the field's
  // focus state upstream; the static border keeps the leading icon from shifting.
  field: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    height: 20,
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  cancel: {
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  cancelPressed: {
    backgroundColor: theme.colors.surface1,
  },
  cancelText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.medium,
  },
}));
