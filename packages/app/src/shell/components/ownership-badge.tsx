// Ownership pill (B4-OWNERSHIP-UI ruling 14; always-on since B5-OWNVIS, batch-5
// F16/D19 用户拍板): one pill, two surfaces — the chat row right after the title
// and the session header capsule. The rules live in shell/chats/ownership.ts
// (`ownershipPresentation`); this is the renderer.
//
// Visual contract: the pill is ALWAYS there — 原生 (paseo holds the session) /
// 外部·外部·运行中 (the B4 warning pair, unchanged: warning-tint with the
// statusWarning word) / 未知 (none or a pre-go.7 daemon — we honestly cannot
// tell). The two quiet states stay out of both existing markers' color stories
// (BATCH4-ALIGNMENT F8.6): 原生 rides a neutral surface fill, 未知 a bare
// outline — the WORD carries the state, the fill only grades loudness, and only
// 外部 is allowed to shout.
import { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ownershipPresentation, type OwnershipPillTone } from "@/shell/chats/ownership";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

// Tone → style, resolved once per theme by StyleSheet.create below; the row and
// the capsule hand the pill FLAT primitive props (it is memo'd and re-renders on
// every directory tick — an object prop would defeat that, and lint).
const PILL_TONE_STYLE: Record<OwnershipPillTone, "pillWarning" | "pillNeutral" | "pillOutline"> = {
  warning: "pillWarning",
  neutral: "pillNeutral",
  outline: "pillOutline",
};

export const OwnershipBadge = memo(function OwnershipBadge({
  ownership,
  externalLooksActive,
  testID,
}: {
  /** Protocol `ownership`; `undefined`/`null` read as `none` → 未知. */
  ownership: string | null | undefined;
  /** Protocol `externalLooksActive`; `undefined`/`null` read as `false`. */
  externalLooksActive: boolean | null | undefined;
  testID?: string;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const presentation = ownershipPresentation({ ownership, externalLooksActive });
  return (
    <View style={[styles.pill, styles[PILL_TONE_STYLE[presentation.tone]]]} testID={testID}>
      <Text
        style={[
          styles.text,
          presentation.tone === "warning" ? styles.textWarning : styles.textQuiet,
        ]}
      >
        {t(presentation.labelKey)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  // Shrink-safe on the title line (the title flexes first, ruling 6's posture)
  // and quiet enough to keep the title the row's protagonist. Geometry only —
  // each tone owns its own fill, so no state can leak a stale background.
  pill: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
  },
  text: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  // The B4 warning story, unchanged: external is the only loud state.
  pillWarning: {
    backgroundColor: theme.colors.statusWarningTint,
  },
  textWarning: {
    color: theme.colors.statusWarning,
  },
  pillNeutral: {
    backgroundColor: theme.colors.surface2,
  },
  pillOutline: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  textQuiet: {
    color: theme.colors.foregroundMuted,
  },
}));
