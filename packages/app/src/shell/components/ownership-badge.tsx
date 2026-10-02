// Ownership pill (B4-OWNERSHIP-UI ruling 14; always-on since B5-OWNVIS, batch-5
// F16/D19 用户拍板): one pill, two surfaces — the chat row right after the title
// and the session header capsule. The rules live in shell/chats/ownership.ts
// (`ownershipPresentation`); this is the renderer.
//
// Visual contract (F22, B8-ROWPILL, 用户拍板): the pill is ALWAYS there — 原生
// (paseo holds the session, or the session was born here and nobody else has
// written it: D22's birth axis) / 外部·外部·运行中 (the B4 word pair, unchanged) /
// 未知 (a host that reported neither an ownership pair nor a birth — we honestly
// cannot tell). All three now wear a low-saturation tint fill with the SAME
// family's deep word on top: 原生 = the success pair, 外部 = the warning pair,
// 未知 = the neutral status pair (statusNeutralTint fill + statusNeutral word,
// REVIEW-B8-10 裁定 D6 — the old surface2+foregroundMuted pair sat at 1.10:1 fill-on-row
// and 4.40:1 word-on-fill in the light band: near-invisible fill, word under AA).
// Every color is a theme token so light/dark follow automatically — no hardcoded hex.
// The tint tokens ARE the status color at 12-16% alpha (theme.ts `statusTints`), which is
// what keeps the grade a 浅染 instead of a shout.
import { memo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ownershipPresentation, type OwnershipPillTone } from "@/shell/chats/ownership";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";

// Tone → style, resolved once per theme by StyleSheet.create below; the row and
// the capsule hand the pill FLAT primitive props (it is memo'd and re-renders on
// every directory tick — an object prop would defeat that, and lint).
const PILL_TONE_STYLE: Record<OwnershipPillTone, "pillWarning" | "pillSuccess" | "pillQuiet"> = {
  warning: "pillWarning",
  neutral: "pillSuccess",
  outline: "pillQuiet",
};
// The word is the fill's own family at full depth — one hue per state, so fill
// and text never drift apart across theme switches.
const PILL_TONE_TEXT: Record<OwnershipPillTone, "textWarning" | "textSuccess" | "textQuiet"> = {
  warning: "textWarning",
  neutral: "textSuccess",
  outline: "textQuiet",
};

export const OwnershipBadge = memo(function OwnershipBadge({
  ownership,
  externalLooksActive,
  origin,
  testID,
}: {
  /** Protocol `ownership`; `undefined`/`null` read as `none` → the birth axis. */
  ownership: string | null | undefined;
  /** Protocol `externalLooksActive`; `undefined`/`null` read as `false`. */
  externalLooksActive: boolean | null | undefined;
  /** Protocol `origin` (COMPAT(agentOrigin)); absent keeps 未知 for an idle session. */
  origin?: string | null;
  testID?: string;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const presentation = ownershipPresentation({ ownership, externalLooksActive, origin });
  return (
    <View style={[styles.pill, styles[PILL_TONE_STYLE[presentation.tone]]]} testID={testID}>
      <Text style={[styles.text, styles[PILL_TONE_TEXT[presentation.tone]]]}>
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
  // 外部 keeps the B4 warning pair verbatim; 原生 moves onto the success pair
  // (F22: the quiet-but-owned state earns its own hue); 未知 takes the neutral
  // pair — the outline it used to wear read as a rendering artifact next to two
  // filled siblings, the fill keeps the three states one shape family.
  pillWarning: {
    backgroundColor: theme.colors.statusWarningTint,
  },
  textWarning: {
    color: theme.colors.statusWarning,
  },
  pillSuccess: {
    backgroundColor: theme.colors.statusSuccessTint,
  },
  textSuccess: {
    color: theme.colors.statusSuccess,
  },
  pillQuiet: {
    backgroundColor: theme.colors.statusNeutralTint,
  },
  textQuiet: {
    color: theme.colors.statusNeutral,
  },
}));
