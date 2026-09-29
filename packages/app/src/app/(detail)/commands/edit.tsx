// 快捷指令表单屏 (card C7, DESIGN §5): 新建/编辑同屏 — `?id=` selects the stored
// command to seed and update, no id means 新建. Fields: 名称* / 主机 / 项目(可空=每次
// 问) / 模型(可空=默认) / prompt 多行*; validation lives in validateCommandForm (pure,
// unit-tested), pickers ride the official menu engine in sheet shape like every other
// shell sheet — each picker is its own component so the form body stays under the
// complexity gate and every menu row keeps a stable handler. KI-9 lives it as a
// (detail) root-Stack push: back — button or hardware/gesture — pops to the
// 工作区 (the entry's only caller), canGoBack兑底 = 工作区 tab.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ChevronDown, ChevronLeft } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { EditingTextInput } from "@/components/ui/text-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { MenuSubTrigger } from "@/components/ui/menu";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { SHELL } from "@/shell/routes";
import { detailBack } from "@/shell/detail-back";
import { usePaseoGoCommandsStore, type ShellCommand } from "@/shell/stores/commands";
import {
  validateCommandForm,
  type CommandFormErrorKey,
  type CommandFormValues,
} from "@/shell/commands/validate";

const ERROR_KEY_LABEL: Record<CommandFormErrorKey, string> = {
  nameRequired: "commands.errors.nameRequired",
  hostRequired: "commands.errors.hostRequired",
  promptRequired: "commands.errors.promptRequired",
};

/** One labelled field shell: label above, control (input or picker) below. */
function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** Press-to-open sheet picker rendered as a form row; `pages` feeds MenuSubTriggers. */
function PickerField({
  label,
  sheetTitle,
  valueLabel,
  placeholder,
  error,
  testID,
  pages,
  children,
}: {
  label: string;
  /** Sheet header override; defaults to the field label. 项目选择器用它对齐
   * 运行选择器的祈使标题（R2-16 F-07：同一概念一个题面）。 */
  sheetTitle?: string;
  valueLabel: string | null;
  placeholder: string;
  error?: string;
  testID: string;
  pages?: readonly MenuPageDefinition[];
  children: ReactNode;
}) {
  const triggerStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.picker, pressed && styles.pickerPressed],
    [],
  );
  return (
    <Field label={label} error={error}>
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger testID={testID} accessibilityRole="button" style={triggerStyle}>
          <Text
            style={[styles.pickerValue, valueLabel === null && styles.pickerPlaceholder]}
            numberOfLines={1}
          >
            {valueLabel ?? placeholder}
          </Text>
          <ChevronDown size={15} color={styles.pickerChevron.color} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sheetTitle={sheetTitle ?? label}
          width={300}
          testID={`${testID}-sheet`}
          pages={pages}
        >
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

/** A checkable sheet row with a stable handler (chat-row-menu pattern). */
function OptionRow({
  label,
  description,
  value,
  selected,
  choose,
  testID,
}: {
  label: string;
  description?: string;
  value: string | null;
  selected: boolean;
  choose: (value: string | null) => void;
  testID: string;
}) {
  const onSelect = useCallback(() => choose(value), [choose, value]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      description={description}
      onSelect={onSelect}
      testID={testID}
    >
      {label}
    </DropdownMenuItem>
  );
}

function HostPicker({
  hosts,
  value,
  onChange,
}: {
  hosts: readonly HostProfile[];
  value: string;
  onChange: (hostId: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const choose = useCallback(
    (candidate: string | null) => {
      if (candidate !== null) onChange(candidate);
    },
    [onChange],
  );
  const label = hosts.find((host) => host.serverId === value)?.label ?? null;
  return (
    <PickerField
      label={t("commands.host")}
      valueLabel={label}
      placeholder={t("commands.hostPlaceholder")}
      testID="shell-command-host-picker"
    >
      {hosts.map((host) => (
        <OptionRow
          key={host.serverId}
          label={host.label}
          value={host.serverId}
          selected={host.serverId === value}
          choose={choose}
          testID={`shell-command-host-${host.serverId}`}
        />
      ))}
    </PickerField>
  );
}

function WorkspacePicker({
  hostId,
  value,
  onChange,
}: {
  hostId: string;
  value: string | null;
  onChange: (workspaceId: string | null) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const workspaces = useSessionStore((state) =>
    hostId ? state.sessions[hostId]?.workspaces : undefined,
  );
  const rows = useMemo(() => {
    const list = Array.from(workspaces?.values() ?? []).map((workspace) => ({
      workspaceId: workspace.id,
      label: workspace.title?.trim() || workspace.name,
      // 项目名才是用户认得的名字（workspace 标题往往是分支名）。
      project:
        workspace.projectCustomName?.trim() ||
        workspace.projectDisplayName ||
        workspace.workspaceDirectory,
    }));
    list.sort(
      (left, right) =>
        left.project.localeCompare(right.project) || left.label.localeCompare(right.label),
    );
    return list;
  }, [workspaces]);
  const selectedRow = value ? rows.find((row) => row.workspaceId === value) : undefined;
  let valueLabel = t("commands.askEveryTime");
  if (selectedRow) valueLabel = `${selectedRow.project} · ${selectedRow.label}`;
  else if (value) valueLabel = value;
  return (
    <PickerField
      label={t("commands.project")}
      sheetTitle={t("commands.pickWorkspace")}
      valueLabel={valueLabel}
      placeholder={t("commands.askEveryTime")}
      testID="shell-command-workspace-picker"
    >
      <OptionRow
        label={t("commands.askEveryTime")}
        value={null}
        selected={value === null}
        choose={onChange}
        testID="shell-command-workspace-ask"
      />
      {rows.map((row) => (
        <OptionRow
          key={row.workspaceId}
          label={row.label}
          description={row.project}
          value={row.workspaceId}
          selected={row.workspaceId === value}
          choose={onChange}
          testID={`shell-command-workspace-${row.workspaceId}`}
        />
      ))}
    </PickerField>
  );
}

function ModelPicker({
  hostId,
  value,
  onChange,
}: {
  hostId: string;
  value: string | null;
  onChange: (providerModel: string | null) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const { entries } = useProvidersSnapshot(hostId || null, { cwd: null });
  const providers = useMemo(
    () =>
      (entries ?? [])
        .filter((entry) => entry.enabled && entry.status === "ready")
        .map((entry) => ({
          provider: entry.provider,
          label: resolveProviderLabel(entry.provider, entries),
          models: (entry.models ?? []).map((model) => ({
            id: model.id,
            label: model.label ?? model.id,
          })),
        })),
    [entries],
  );
  // One pushed page per provider: 该 provider 默认 + 具体模型. Built in a memo so no
  // JSX crosses a prop boundary per render (chat-row-menu pages pattern).
  const pages = useMemo(
    () =>
      providers.map((provider) => ({
        id: provider.provider,
        title: provider.label,
        hoverIntent: false,
        content: (
          <>
            <OptionRow
              label={t("commands.modelProviderDefault", { provider: provider.label })}
              value={provider.provider}
              selected={value === provider.provider}
              choose={onChange}
              testID={`shell-command-model-${provider.provider}-default`}
            />
            {provider.models.map((model) => (
              <OptionRow
                key={model.id}
                label={model.label}
                value={`${provider.provider}/${model.id}`}
                selected={value === `${provider.provider}/${model.id}`}
                choose={onChange}
                testID={`shell-command-model-${provider.provider}-${model.id}`}
              />
            ))}
          </>
        ),
      })),
    [providers, value, onChange, t],
  );
  return (
    <PickerField
      label={t("commands.model")}
      valueLabel={value}
      placeholder={t("commands.defaultModel")}
      testID="shell-command-model-picker"
      pages={pages}
    >
      <OptionRow
        label={t("commands.defaultModel")}
        value={null}
        selected={value === null}
        choose={onChange}
        testID="shell-command-model-default"
      />
      {providers.map((provider) => (
        <MenuSubTrigger
          key={provider.provider}
          id={provider.provider}
          testID={`shell-command-model-${provider.provider}`}
        >
          {provider.label}
        </MenuSubTrigger>
      ))}
    </PickerField>
  );
}

type CommandFormValidationErrors = Partial<Record<keyof CommandFormValues, CommandFormErrorKey>>;

function CommandFormBody({
  command,
  onSaved,
}: {
  command: ShellCommand | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const hosts = useHosts();
  const [values, setValues] = useState<CommandFormValues>({
    name: command?.name ?? "",
    hostId: command?.hostId ?? hosts[0]?.serverId ?? "",
    workspaceId: command?.workspaceId ?? null,
    providerModel: command?.providerModel ?? null,
    prompt: command?.prompt ?? "",
  });
  const [errors, setErrors] = useState<CommandFormValidationErrors>({});

  const changeName = useCallback(
    (text: string) => setValues((current) => ({ ...current, name: text })),
    [],
  );
  const changePrompt = useCallback(
    (text: string) => setValues((current) => ({ ...current, prompt: text })),
    [],
  );
  const selectWorkspace = useCallback(
    (workspaceId: string | null) => setValues((current) => ({ ...current, workspaceId })),
    [],
  );
  const selectModel = useCallback(
    (providerModel: string | null) => setValues((current) => ({ ...current, providerModel })),
    [],
  );
  const selectHost = useCallback((hostId: string) => {
    // Host identity owns the workspace/model namespaces — a stale selection from
    // the previous host would assemble an impossible run plan.
    setValues((current) => ({
      ...current,
      hostId,
      workspaceId: null,
      providerModel: null,
    }));
  }, []);

  const handleSave = useCallback(() => {
    const validation = validateCommandForm(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    const store = usePaseoGoCommandsStore.getState();
    if (command) store.updateCommand(command.id, validation.value);
    else store.addCommand(validation.value);
    onSaved();
  }, [values, command, onSaved]);

  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.bodyContent}
      keyboardShouldPersistTaps="handled"
      testID="shell-command-form"
    >
      <Field
        label={t("commands.name")}
        error={errors.name ? t(ERROR_KEY_LABEL[errors.name]) : undefined}
      >
        <EditingTextInput
          initialValue={values.name}
          onChangeText={changeName}
          placeholder={t("commands.namePlaceholder")}
          placeholderTextColor={styles.placeholder.color}
          testID="shell-command-name-input"
          style={styles.input}
          returnKeyType="done"
        />
      </Field>

      <HostPicker hosts={hosts} value={values.hostId} onChange={selectHost} />
      <WorkspacePicker
        hostId={values.hostId}
        value={values.workspaceId}
        onChange={selectWorkspace}
      />
      <ModelPicker hostId={values.hostId} value={values.providerModel} onChange={selectModel} />

      <Field
        label={t("commands.prompt")}
        error={errors.prompt ? t(ERROR_KEY_LABEL[errors.prompt]) : undefined}
      >
        <EditingTextInput
          initialValue={values.prompt}
          onChangeText={changePrompt}
          placeholder={t("commands.promptPlaceholder")}
          placeholderTextColor={styles.placeholder.color}
          testID="shell-command-prompt-input"
          style={styles.promptInput}
          multiline
        />
      </Field>

      <Button
        variant="default"
        onPress={handleSave}
        testID="shell-command-save"
        style={styles.saveButton}
      >
        {t("commands.save")}
      </Button>
    </ScrollView>
  );
}

export default function DetailCommandEditScreen() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();

  // The form seeds its initial state from the store — that seed must wait for the
  // persist rehydration or 编辑 would open on an empty form (and a 新建 save could
  // land before the stored snapshot and be overwritten by it).
  const [hydrated, setHydrated] = useState(() => usePaseoGoCommandsStore.persist.hasHydrated());
  useEffect(() => usePaseoGoCommandsStore.persist.onFinishHydration(() => setHydrated(true)), []);
  const command = usePaseoGoCommandsStore((state) =>
    id ? (state.items.find((item) => item.id === id) ?? null) : null,
  );

  // KI-9 返回：真弹栈回来源（工作区 ＋新建/行编辑），深链直达时兑底 replace 回
  // 工作区 tab；保存走同一 handleBack。硬件/手势返回由根栈原生处理。
  const handleBack = useCallback(() => detailBack(SHELL.workspace), []);

  const title = command ? t("commands.editTitle") : t("commands.newTitle");

  return (
    <View style={styles.screen}>
      <View
        style={[styles.header, { paddingTop: insets.top + 8 }]}
        testID="shell-command-edit-header"
      >
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.back}
          testID="shell-command-edit-back"
        >
          <ChevronLeft size={22} color={styles.backIcon.color} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {hydrated ? <CommandFormBody command={command} onSaved={handleBack} /> : <FormSkeleton />}
    </View>
  );
}

// C12: persist rehydration used to leave a bare-white frame under the header —
// render a static form-shaped skeleton (label bar + field box ×4) instead.
function FormSkeleton() {
  return (
    <View style={styles.skeleton} testID="shell-command-edit-skeleton">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonField}>
          <View style={styles.skeletonLabel} />
          <View style={styles.skeletonBox} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  skeleton: {
    flex: 1,
    gap: theme.spacing[4],
    padding: theme.spacing[4],
  },
  skeletonField: {
    gap: theme.spacing[2],
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
    flex: 1,
  },
  bodyContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  field: {
    gap: theme.spacing[2],
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  fieldError: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
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
  promptInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    minHeight: 140,
    textAlignVertical: "top",
  },
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  pickerPressed: {
    opacity: 0.85,
  },
  pickerValue: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  pickerPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  pickerChevron: {
    color: theme.colors.foregroundMuted,
  },
  saveButton: {
    marginTop: theme.spacing[2],
  },
}));
