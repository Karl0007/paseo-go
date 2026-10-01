// Injects shell copy into the official i18next instance (DESIGN.md §2.4): a dedicated
// `paseoGo` namespace, so upstream locale files stay untouched. Registering under both
// `zh` and `zh-CN` keeps lookup deterministic regardless of the active language tag.
import { i18n } from "@/i18n/i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const SHELL_I18N_NAMESPACE = "paseoGo";

interface LanguageChangedBus {
  on(event: "languageChanged", handler: (lng: string) => void): void;
  off(event: "languageChanged", handler: (lng: string) => void): void;
  emit(event: "languageChanged", lng: string): void;
}

// B4-LANG: the official I18nProvider calls `changeLanguage()` DURING RENDER
// (ensureI18nLanguageForRender). i18next emits `languageChanged` synchronously there, so
// react-i18next's store-change callbacks fire inside React's render phase — React defers
// or drops those subscriber re-renders (device LogBox: "Cannot update a component
// (ToastProvider) while rendering a different component (I18nProvider)"). Result: after a
// language switch, surfaces keep the OLD copy until some unrelated re-render (RevUI
// observed the shell stuck in Chinese; on-device the whole visible subtree lagged one
// render). Re-emitting `languageChanged` from a macrotask hands every subscriber a clean
// event-time update; the payload is irrelevant (react-i18next re-reads `i18n.language`),
// and the pending flag makes the relay consume its own echo, so the chain terminates.
export function attachLanguageRebroadcast(bus: LanguageChangedBus): () => void {
  let rebroadcastPending = false;
  const relay = (lng: string): void => {
    if (rebroadcastPending) {
      rebroadcastPending = false;
      return;
    }
    rebroadcastPending = true;
    setTimeout(() => bus.emit("languageChanged", lng), 0);
  };
  bus.on("languageChanged", relay);
  return () => bus.off("languageChanged", relay);
}

let injected = false;

export function ensureShellI18n(): void {
  if (injected) return;
  injected = true;
  i18n.addResourceBundle("en", SHELL_I18N_NAMESPACE, en, true, true);
  i18n.addResourceBundle("zh", SHELL_I18N_NAMESPACE, zh, true, true);
  i18n.addResourceBundle("zh-CN", SHELL_I18N_NAMESPACE, zh, true, true);
  attachLanguageRebroadcast(i18n);
}

ensureShellI18n();
