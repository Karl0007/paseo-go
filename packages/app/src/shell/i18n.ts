// Injects shell copy into the official i18next instance (DESIGN.md §2.4): a dedicated
// `paseoGo` namespace, so upstream locale files stay untouched. Registering under both
// `zh` and `zh-CN` keeps lookup deterministic regardless of the active language tag.
import { i18n } from "@/i18n/i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const SHELL_I18N_NAMESPACE = "paseoGo";

let injected = false;

export function ensureShellI18n(): void {
  if (injected) return;
  injected = true;
  i18n.addResourceBundle("en", SHELL_I18N_NAMESPACE, en, true, true);
  i18n.addResourceBundle("zh", SHELL_I18N_NAMESPACE, zh, true, true);
  i18n.addResourceBundle("zh-CN", SHELL_I18N_NAMESPACE, zh, true, true);
}

ensureShellI18n();
