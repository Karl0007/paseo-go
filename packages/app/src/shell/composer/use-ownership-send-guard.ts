// Shell-lifetime wiring of the R4 send guard (see ownership-send-guard.ts for the
// rules): mounted on the shell tab layout next to useShellNotifications, so the
// wrapper exists exactly while the shell UI owns the screen stack. Language change
// re-installs with a fresh `t`; the WeakSet keeps that re-install single-wrapped.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "@/utils/confirm-dialog";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { installOwnershipSendGuard } from "@/shell/composer/ownership-send-guard";

export function useOwnershipSendGuard(): void {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  useEffect(() => installOwnershipSendGuard({ t, confirm: confirmDialog }), [t]);
}
