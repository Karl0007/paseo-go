// 工作区 screen body (C31 extraction, C16 body pattern): the whole 工作区 tab UI —
// 搜索 + 收藏夹区 + 主机分组 + C26 三层树 — lifted out of (shell)/workspace.tsx so the
// tablet split can host a second instance in its left column. The thin route screen
// renders this verbatim on compact (§6 竖屏零回退); when the split is active it renders
// the detail placeholder and the column mounts this component instead.
//
// Navigator-context hooks moved to module buses (the column lives outside every
// navigator): the C18/C26 L3 focus beat rides the section-focus bus, and the §4-8
// rail retap scrolls the tree FlatList through rail-events (a real scrollToOffset —
// unlike chats this list is a plain FlatList with a ref). 展开态 stays in this
// component's useState (C26 ruling: 屏内 only): the column keep-alives visited
// bodies, so expansion survives tab round-trips and session pushes.
//
// --- original screen notes (unchanged behaviour, cards C5-C26) ---
// 工作区 tab (DESIGN §5 + §14.8, cards C5+C6+C7+C9+C26): 搜索 (C9: the bar morphs into
// an input; 文件名 hits come from the session-store explorer cache — the protocol has
// no filename-search RPC, so only 已浏览目录 are covered, which the empty state says
// out loud; a hit pushes the C6 preview directly) → 收藏夹区 (files star + ⚡ 快捷指令
// 混排) → 主机分组 (连接点 + 名称 + ⚙ 官方 host settings；离线置灰+重试) → 三层树
// (L1 工程行 = 展开/收起 → L2 worktree 行 = 物理合并 (cwd+branch)，行体进文件页，长按
// 复制路径/归档 → L3 session 行 = C4 opener + C3 长按菜单). 展开态 = 屏内 useState
// (不 persist). ＋新建项目 / ＋连接新主机 (官方流程). Cold start rides the official
// skeleton; pull-to-refresh re-pulls agents + directories.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { FolderTree, Plus, Search, SearchX, Star, Zap, type LucideIcon } from "lucide-react-native";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents, type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useProjects } from "@/hooks/use-projects";
import { getHostRuntimeStore, useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { OFFICIAL, shellCommandEditHref, shellFilesHref, shellPreviewHref } from "@/shell/routes";
import { useShellHostStatuses } from "@/shell/runtime/use-shell-host-statuses";
import { WorkspaceHostHeader } from "@/shell/components/workspace-host-header";
import { WorkspaceProjectRow } from "@/shell/components/workspace-project-row";
import { WorkspaceFavoriteRow } from "@/shell/components/workspace-favorite-row";
import { WorkspaceCommandRow } from "@/shell/components/workspace-command-row";
import { createChatOpener } from "@/shell/chats/open-agent";
import { chatLastEventAtFromAgent } from "@/shell/chats/derive";
import { isImportedProviderSession } from "@getpaseo/protocol/agent-labels";
import { confirmDialog } from "@/utils/confirm-dialog";
import { usePaseoGoForkAckStore } from "@/shell/stores/forkAck";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";
import { WorkspaceWorktreeRow } from "@/shell/components/workspace-worktree-row";
import { WorkspaceSessionRow } from "@/shell/components/workspace-session-row";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { usePaseoGoArchiveStore } from "@/shell/stores/archive";
import { useShellAgentActions } from "@/shell/shellAgentActions";
import { archiveWorkspacesOptimistically } from "@/workspace/workspace-archive";
import { archiveWorktreeRowWithRiskGate } from "@/shell/workspace/archive-gate";
import {
  CommandWorkspacePickerSheet,
  type CommandWorkspaceOption,
} from "@/shell/components/command-workspace-picker";
import { usePaseoGoFavoritesStore, type ShellFavoriteFile } from "@/shell/stores/favorites";
import { usePaseoGoCommandsStore, type ShellCommand } from "@/shell/stores/commands";
import { useShellCommandRunner } from "@/shell/commands/use-shell-command-runner";
import { SearchModeBar } from "@/shell/components/search/search-mode-bar";
import { FileSearchRow } from "@/shell/components/search/file-search-row";
import {
  collectBrowsedWorkspaces,
  searchFileNames,
  type FileSearchHit,
  type FileSearchSource,
} from "@/shell/search/file-search";
import { normalizeSearchQuery } from "@/shell/search/query";
import {
  buildWorkspaceTree,
  type ShellHostSection,
  type ShellProjectRow,
  type ShellWorktreeRow,
  type WorkspaceTreeSession,
} from "@/shell/workspace/derive";
import { subscribeSectionFocus } from "@/shell/section-focus";
import { subscribeRailRetap } from "@/shell/tablet/rail-events";
import type { ShellScreenBodyProps } from "./shell-screen-body-props";

const REFRESH_SETTLE_MS = 700;

type TreeItem =
  | { type: "favorites-header"; key: string }
  | { type: "favorites-empty"; key: string }
  | { type: "new-command"; key: string }
  | {
      type: "favorite";
      key: string;
      favorite: ShellFavoriteFile;
      hostLabel: string;
      dimmed: boolean;
    }
  | {
      type: "command";
      key: string;
      command: ShellCommand;
      hostLabel: string;
      dimmed: boolean;
      running: boolean;
    }
  | { type: "host"; key: string; section: ShellHostSection<AggregatedAgent> }
  | { type: "host-empty"; key: string; label: string }
  | {
      type: "project";
      key: string;
      row: ShellProjectRow<AggregatedAgent>;
      dimmed: boolean;
      expanded: boolean;
    }
  | {
      type: "worktree";
      key: string;
      row: ShellWorktreeRow<AggregatedAgent>;
      dimmed: boolean;
      expanded: boolean;
    }
  | { type: "worktree-empty"; key: string }
  | {
      type: "session";
      key: string;
      session: WorkspaceTreeSession<AggregatedAgent>;
      dimmed: boolean;
    };

// 收藏夹区 empty state — until the first 收藏 lands (files screen chip / preview
// star), the card teaches the gesture that fills the section below.
function FavoritesPlaceholder() {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.favoritesEmpty} testID="shell-workspace-favorites-empty">
      <Star size={16} color={styles.favoritesEmptyIcon.color} />
      <Text style={styles.favoritesEmptyText}>{t("workspace.favoritesEmpty")}</Text>
    </View>
  );
}

// 空态 (DESIGN §5): no host at all → guide into the official connect flow.
function WorkspaceEmptyState({ onConnectHost }: { onConnectHost: () => void }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.empty} testID="shell-workspace-empty">
      <View style={styles.emptyIconWrap}>
        <FolderTree size={28} color={styles.emptyIcon.color} />
      </View>
      <Text style={styles.emptyTitle}>{t("workspace.emptyTitle")}</Text>
      <Text style={styles.emptyHint}>{t("workspace.emptyHint")}</Text>
      <Button onPress={onConnectHost} testID="shell-empty-connect-host">
        {t("workspace.connectHost")}
      </Button>
    </View>
  );
}

// 文件搜索空态 (C9 + C12): icon + miss line + the honest scope note + 清除搜索;
// the client-side filter only sees directories this app run has browsed (no
// filename-search RPC upstream). With an empty query just the scope note leads.
function FileSearchEmptyState({ searching, onClear }: { searching: boolean; onClear: () => void }) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.searchEmpty} testID="shell-workspace-search-empty">
      {searching ? (
        <>
          <View style={styles.emptyIconWrap}>
            <SearchX size={28} color={styles.emptyIcon.color} />
          </View>
          <Text style={styles.emptyTitle}>{t("workspace.searchEmptyTitle")}</Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={onClear}
            testID="shell-workspace-search-clear"
          >
            {t("workspace.searchEmptyAction")}
          </Button>
        </>
      ) : null}
      <Text style={styles.emptyHint}>{t("workspace.searchEmptyHint")}</Text>
    </View>
  );
}

function ActionRow({
  Icon,
  label,
  onPress,
  testID,
}: {
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [styles.actionRow, pressed && styles.rowPressed],
    [],
  );
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={rowStyle} testID={testID}>
      <View style={styles.actionIconWrap}>
        <Icon size={16} color={styles.actionIcon.color} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export function WorkspaceScreenBody({ selectedAgentKey = null }: ShellScreenBodyProps) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const openAddProject = useOpenAddProject();

  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const { projects, isLoading: projectsLoading, refetch } = useProjects();
  const { agents, isInitialLoad, refreshAll } = useAggregatedAgents();

  const hostIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useShellHostStatuses(hostIds);
  const hostsById = useMemo(
    () => new Map(hosts.map((host) => [host.serverId, host] as const)),
    [hosts],
  );

  // C26: the cwd axis of the L2 physical identity comes from the session-store
  // descriptors (WorkspaceSummary carries no path). Keys mirror the tree's record keys.
  const sessions = useSessionStore((state) => state.sessions);
  const workspacePaths = useMemo(() => {
    const paths = new Map<string, string>();
    for (const [serverId, session] of Object.entries(sessions)) {
      for (const descriptor of session.workspaces.values()) {
        const directory = descriptor.workspaceDirectory || descriptor.projectRootPath || "";
        if (directory) paths.set(`${serverId}:${descriptor.id}`, directory);
      }
    }
    return paths;
  }, [sessions]);

  // R2-08①: 壳归档 rows leave L3 and the badges — the same store the 对话 tab
  // filters on (chats-screen-body), now feeding the tree derivation too.
  const archivedIds = usePaseoGoArchiveStore((state) => state.archivedIds);

  const sections = useMemo(
    () => buildWorkspaceTree({ hosts, statuses, projects, agents, workspacePaths, archivedIds }),
    [hosts, statuses, projects, agents, workspacePaths, archivedIds],
  );

  // C26 L3: the 对话 tab's C4 opener verbatim — markRead 双拍 in the chat's own
  // host-clock domain + the official navigateToAgent (workspace route + open intent),
  // including C24's fork guard: an imported chat's first open confirms once.
  // R2-02/03: the pending visit lives on the module ledger (this body dying with
  // a section switch no longer loses it); settlement happens at the leave moments.
  const markRead = usePaseoGoReadStateStore((state) => state.markRead);
  const opener = useMemo(
    () =>
      createChatOpener({
        markRead,
        navigateToAgent: shellNavigateToAgent,
        lastEventAtOf: (serverId, agentId) => {
          const agent = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
          // R2-14: null (garbage host dates) maps to undefined = "no fresh
          // watermark"; the opener keeps its pending visit, never writes NaN.
          return agent ? (chatLastEventAtFromAgent(agent) ?? undefined) : undefined;
        },
        confirmFork: () =>
          confirmDialog({
            title: t("chats.fork.title"),
            message: t("chats.fork.message"),
            confirmLabel: t("chats.fork.confirm"),
            cancelLabel: t("chats.fork.cancel"),
          }),
        forkAcknowledged: (key) => usePaseoGoForkAckStore.getState().ackedKeys.includes(key),
        acknowledgeFork: (key) => usePaseoGoForkAckStore.getState().ack(key),
        section: "workspace",
      }),
    [markRead, t],
  );
  // C31: the L3 return-stamp beat rides the section-focus bus (the body is outside
  // the navigator in its wide position; the tab screen emits on real focus).
  useEffect(() => subscribeSectionFocus("workspace", () => opener.onFocus()), [opener]);

  // C31 §4-8: rail retap = 回顶 — a real animated scrollToOffset on the tree list.
  const treeListRef = useRef<FlatList<TreeItem> | null>(null);
  useEffect(
    () =>
      subscribeRailRetap((section) => {
        if (section === "workspace")
          treeListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }),
    [],
  );
  const actions = useShellAgentActions();

  // 展开态 (裁定): 屏内 useState, 不 persist、不跨启动; keys come from the derivation
  // (project key = host:projectId, worktree key = host:projectId:wt:identity).
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedWorktrees, setExpandedWorktrees] = useState<ReadonlySet<string>>(() => new Set());

  // C9 文件名搜索: the session-store explorer cache is the index (no filename-search
  // RPC upstream — see shell/search/file-search.ts). Built only while search mode is
  // open; names reuse the tree sections so results label like the tree below.
  const [searchActive, setSearchActive] = useState(false);
  const [query, setQuery] = useState("");
  const searchSources = useMemo<FileSearchSource[]>(() => {
    if (!searchActive) return [];
    const names = new Map<string, string>();
    for (const section of sections) {
      for (const projectRow of section.projects) {
        for (const worktree of projectRow.worktrees) {
          for (const workspaceId of worktree.workspaceIds) {
            names.set(`${section.serverId}:${workspaceId}`, worktree.name);
          }
        }
      }
    }
    const out: FileSearchSource[] = [];
    for (const [serverId, session] of Object.entries(sessions)) {
      for (const { workspaceId, entries } of collectBrowsedWorkspaces(session.fileExplorer)) {
        const descriptor = session.workspaces.get(workspaceId);
        out.push({
          serverId,
          hostLabel: hostsById.get(serverId)?.label ?? serverId,
          workspaceId,
          workspaceName:
            names.get(`${serverId}:${workspaceId}`) ??
            descriptor?.projectDisplayName ??
            workspaceId,
          workspaceRoot: descriptor?.workspaceDirectory || descriptor?.projectRootPath || "",
          entries,
        });
      }
    }
    return out;
  }, [searchActive, sessions, sections, hostsById]);
  const searchHits = useMemo(
    () => (searchActive ? searchFileNames(searchSources, query) : []),
    [searchActive, searchSources, query],
  );
  const searching = searchActive && normalizeSearchQuery(query).length > 0;

  const favorites = usePaseoGoFavoritesStore((state) => state.items);
  const commands = usePaseoGoCommandsStore((state) => state.items);
  const { runningId, pickerCommand, requestRun, selectWorkspace, closePicker, remove } =
    useShellCommandRunner();
  const items = useMemo<TreeItem[]>(() => {
    const out: TreeItem[] = [
      { type: "favorites-header", key: "favorites-header" },
      { type: "new-command", key: "new-command" },
    ];
    if (favorites.length === 0 && commands.length === 0) {
      out.push({ type: "favorites-empty", key: "favorites-empty" });
    }
    // 混排 (DESIGN §5): 文件与 ⚡ 快捷指令按各自的加入时间倒序穿插在同一收藏夹区。
    const entries: { at: number; item: TreeItem }[] = [
      ...favorites.map((favorite) => ({
        at: favorite.addedAt,
        item: {
          type: "favorite" as const,
          key: `favorite:${favorite.hostId}:${favorite.path}`,
          favorite,
          hostLabel: hostsById.get(favorite.hostId)?.label ?? favorite.hostId,
          dimmed: (statuses.get(favorite.hostId) ?? "connecting") !== "online",
        },
      })),
      ...commands.map((command) => ({
        at: command.createdAt,
        item: {
          type: "command" as const,
          key: `command:${command.id}`,
          command,
          hostLabel: hostsById.get(command.hostId)?.label ?? command.hostId,
          dimmed: (statuses.get(command.hostId) ?? "connecting") !== "online",
          running: runningId === command.id,
        },
      })),
    ];
    entries.sort((left, right) => right.at - left.at);
    for (const entry of entries) out.push(entry.item);
    for (const section of sections) {
      out.push({ type: "host", key: `host:${section.serverId}`, section });
      if (section.projects.length === 0) {
        out.push({
          type: "host-empty",
          key: `host-empty:${section.serverId}`,
          label: section.isOnline ? t("workspace.hostEmpty") : t("workspace.hostEmptyOffline"),
        });
      }
      const dimmed = !section.isOnline;
      for (const projectRow of section.projects) {
        const projectExpanded = expandedProjects.has(projectRow.key);
        out.push({
          type: "project",
          key: `project:${projectRow.key}`,
          row: projectRow,
          dimmed,
          expanded: projectExpanded,
        });
        if (!projectExpanded) continue;
        for (const worktree of projectRow.worktrees) {
          const worktreeExpanded = expandedWorktrees.has(worktree.key);
          out.push({
            type: "worktree",
            key: `worktree:${worktree.key}`,
            row: worktree,
            dimmed,
            expanded: worktreeExpanded,
          });
          if (!worktreeExpanded) continue;
          if (worktree.sessions.length === 0) {
            // worktree 无对话 → 「暂无对话」行 (裁定 4).
            out.push({ type: "worktree-empty", key: `worktree-empty:${worktree.key}` });
            continue;
          }
          for (const sessionRow of worktree.sessions) {
            out.push({
              type: "session",
              key: `session:${worktree.key}:${sessionRow.key}`,
              session: sessionRow,
              dimmed,
            });
          }
        }
      }
    }
    return out;
  }, [
    sections,
    expandedProjects,
    expandedWorktrees,
    t,
    favorites,
    commands,
    runningId,
    hostsById,
    statuses,
  ]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRefresh = useCallback(() => {
    refreshAll();
    refetch();
    setRefreshing(true);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setRefreshing(false), REFRESH_SETTLE_MS);
  }, [refreshAll, refetch]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const handleRetryHost = useCallback(
    (serverId: string) => {
      void getHostRuntimeStore().runProbeCycleNow(serverId);
      toast.show(t("chats.retrying", { label: hostsById.get(serverId)?.label ?? serverId }));
    },
    [hostsById, toast, t],
  );
  const handleOpenSettings = useCallback(
    (serverId: string) => router.push(OFFICIAL.hostSettings(serverId) as Href),
    [],
  );
  const handleNewProject = useCallback(() => openAddProject(), [openAddProject]);
  const handleConnectHost = useCallback(
    () => router.push(OFFICIAL.addHost(Date.now()) as Href),
    [],
  );
  const handleSearchOpen = useCallback(() => setSearchActive(true), []);
  const handleSearchClose = useCallback(() => {
    setSearchActive(false);
    setQuery("");
  }, []);
  const handleOpenHit = useCallback(
    (hit: FileSearchHit) =>
      router.push(
        shellPreviewHref({
          serverId: hit.serverId,
          workspaceId: hit.workspaceId,
          path: hit.path,
          name: hit.name,
          workspaceRoot: hit.workspaceRoot,
        }) as Href,
      ),
    [],
  );
  const renderSearchRow = useCallback(
    ({ item }: { item: FileSearchHit }) => <FileSearchRow hit={item} onOpen={handleOpenHit} />,
    [handleOpenHit],
  );
  const searchKeyExtractor = useCallback((hit: FileSearchHit) => hit.key, []);
  const toggleProject = useCallback(
    (row: ShellProjectRow<AggregatedAgent>) =>
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        return next;
      }),
    [],
  );
  const toggleWorktree = useCallback(
    (row: ShellWorktreeRow<AggregatedAgent>) =>
      setExpandedWorktrees((prev) => {
        const next = new Set(prev);
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        return next;
      }),
    [],
  );
  // L2 行体 = 该 worktree 的文件页 (代表记录 id, 裁定 §14.8)。
  const handleOpenWorktree = useCallback(
    (row: ShellWorktreeRow<AggregatedAgent>) =>
      router.push(shellFilesHref(row.serverId, row.workspaceId)),
    [],
  );
  // L3 行体 = C4 opener (fork 门 → markRead 双拍 + navigateToAgent)。
  const handleOpenSession = useCallback(
    (session: WorkspaceTreeSession<AggregatedAgent>) => {
      void opener.open({
        key: session.key,
        serverId: session.agent.serverId,
        agentId: session.agent.id,
        workspaceId: session.agent.workspaceId,
        lastEventAt: session.lastEventAt,
        imported: isImportedProviderSession(session.agent),
      });
    },
    [opener],
  );
  // L2 长按「归档工作区」: 官方 archiveWorkspace RPC (workspace-archive 乐观隐藏，
  // 失败自动回滚)，对合并前全部记录一次执行。R2-08②: 先闸后归档 — every merged
  // record first clears the OFFICIAL worktree archive risk confirm
  // (selectProjectWorkspacesToArchive → confirmRiskyWorktreeArchive +
  // toWorktreeArchiveRisk, the sidebar-workspace-list rows' call shape); only the
  // confirmed targets reach the RPC, an all-decline is a no-op.
  const handleArchiveWorktree = useCallback(
    (row: ShellWorktreeRow<AggregatedAgent>) => {
      void (async () => {
        const { attempted, failures } = await archiveWorktreeRowWithRiskGate({
          row,
          descriptorOf: (serverId, workspaceId) =>
            useSessionStore.getState().sessions[serverId]?.workspaces.get(workspaceId),
          archive: (workspaces) =>
            archiveWorkspacesOptimistically({
              getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
              workspaces,
            }),
        });
        if (attempted.length === 0) return;
        if (failures.length === 0) {
          toast.show(t("workspace.toast.workspaceArchived"));
          refetch();
        } else {
          const first = failures[0];
          const message =
            first && first.error instanceof Error
              ? first.error.message
              : String(first?.error ?? "");
          toast.error(t("workspace.toast.archiveFailed", { message }));
        }
      })();
    },
    [toast, t, refetch],
  );
  const handleNewCommand = useCallback(() => router.push(shellCommandEditHref() as Href), []);
  const handleEditCommand = useCallback(
    (command: ShellCommand) => router.push(shellCommandEditHref(command.id) as Href),
    [],
  );
  const handleRemoveCommand = useCallback(
    (command: ShellCommand) => void remove(command),
    [remove],
  );

  // 项目选择 sheet (workspaceId 缺省): the host's own sections rows, same labels and
  // order the tree below shows — one derivation, no second workspace list.
  const pickerOptions = useMemo<CommandWorkspaceOption[]>(() => {
    if (!pickerCommand) return [];
    const section = sections.find((entry) => entry.serverId === pickerCommand.hostId);
    if (!section) return [];
    const options: CommandWorkspaceOption[] = [];
    for (const projectRow of section.projects) {
      for (const worktree of projectRow.worktrees) {
        options.push({
          workspaceId: worktree.workspaceId,
          name: worktree.name,
          projectName: projectRow.name,
        });
      }
    }
    return options;
  }, [sections, pickerCommand]);

  const renderItem = useCallback(
    ({ item }: { item: TreeItem }) => {
      switch (item.type) {
        case "favorites-header":
          return (
            <View style={styles.sectionHeader} testID="shell-workspace-favorites-header">
              <Star size={12} color={styles.sectionHeaderText.color} />
              <Text style={styles.sectionHeaderText}>{t("workspace.favoritesTitle")}</Text>
            </View>
          );
        case "favorites-empty":
          return <FavoritesPlaceholder />;
        case "favorite":
          return (
            <WorkspaceFavoriteRow
              favorite={item.favorite}
              hostLabel={item.hostLabel}
              dimmed={item.dimmed}
            />
          );
        case "new-command":
          return (
            <ActionRow
              Icon={Zap}
              label={t("workspace.newCommand")}
              onPress={handleNewCommand}
              testID="shell-workspace-new-command"
            />
          );
        case "command":
          return (
            <WorkspaceCommandRow
              command={item.command}
              hostLabel={item.hostLabel}
              dimmed={item.dimmed}
              running={item.running}
              onRun={requestRun}
              onEdit={handleEditCommand}
              onRemove={handleRemoveCommand}
            />
          );
        case "host":
          return (
            <WorkspaceHostHeader
              serverId={item.section.serverId}
              label={item.section.label}
              isOnline={item.section.isOnline}
              onOpenSettings={handleOpenSettings}
              onRetry={handleRetryHost}
            />
          );
        case "host-empty":
          return <Text style={styles.hostEmpty}>{item.label}</Text>;
        case "project":
          return (
            <WorkspaceProjectRow
              row={item.row}
              dimmed={item.dimmed}
              expanded={item.expanded}
              onToggle={toggleProject}
            />
          );
        case "worktree":
          return (
            <WorkspaceWorktreeRow
              row={item.row}
              dimmed={item.dimmed}
              expanded={item.expanded}
              onToggle={toggleWorktree}
              onOpenFiles={handleOpenWorktree}
              onArchive={handleArchiveWorktree}
            />
          );
        case "worktree-empty":
          return (
            <Text style={styles.worktreeEmpty} testID="shell-workspace-worktree-empty">
              {t("workspace.worktreeEmpty")}
            </Text>
          );
        case "session":
          return (
            <WorkspaceSessionRow
              session={item.session}
              dimmed={item.dimmed}
              actions={actions}
              onOpen={handleOpenSession}
              selected={item.session.key === selectedAgentKey}
            />
          );
      }
    },
    [
      handleOpenSettings,
      handleRetryHost,
      toggleProject,
      toggleWorktree,
      handleOpenWorktree,
      handleOpenSession,
      handleArchiveWorktree,
      actions,
      handleNewCommand,
      handleEditCommand,
      handleRemoveCommand,
      requestRun,
      selectedAgentKey,
      t,
    ],
  );

  const keyExtractor = useCallback((item: TreeItem) => item.key, []);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <ActionRow
          Icon={Plus}
          label={t("workspace.newProject")}
          onPress={handleNewProject}
          testID="shell-workspace-new-project"
        />
        <ActionRow
          Icon={FolderTree}
          label={t("workspace.connectHost")}
          onPress={handleConnectHost}
          testID="shell-workspace-connect-host"
        />
      </View>
    ),
    [t, handleNewProject, handleConnectHost],
  );

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={styles.refreshTint.color}
      />
    ),
    [refreshing, handleRefresh],
  );

  // C12: mask until BOTH the project list and the first agent-directory wave land —
  // otherwise a fast projects response flashes 「暂无项目」 under still-arriving agents.
  const showSkeleton =
    hostRegistryStatus === "loading" || (hosts.length > 0 && (projectsLoading || isInitialLoad));
  const hasHosts = hosts.length > 0;
  // Stable element identity for FlatList (the chats tab's listEmpty idiom).
  const searchListEmpty = useMemo(
    () => <FileSearchEmptyState searching={searching} onClear={handleSearchClose} />,
    [searching, handleSearchClose],
  );

  let body: ReactNode;
  if (searchActive) {
    // 结果替换列表区 (C9 ruling): the tree is fully swapped for the hit list.
    body = (
      <FlatList
        data={searchHits}
        keyExtractor={searchKeyExtractor}
        renderItem={renderSearchRow}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={searchListEmpty}
        testID="shell-workspace-search-results"
      />
    );
  } else if (showSkeleton) {
    body = (
      <View style={styles.skeletonWrap} testID="shell-workspace-skeleton">
        <SidebarAgentListSkeleton />
      </View>
    );
  } else if (hasHosts) {
    body = (
      <FlatList
        ref={treeListRef}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListFooterComponent={footer}
        contentContainerStyle={styles.listContent}
        refreshControl={refreshControl}
        extraData={selectedAgentKey}
        testID="shell-workspace-list"
      />
    );
  } else {
    body = (
      <View style={styles.emptyWrap}>
        <WorkspaceEmptyState onConnectHost={handleConnectHost} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {searchActive ? (
          <SearchModeBar
            onQueryChange={setQuery}
            onCancel={handleSearchClose}
            placeholder={t("workspace.searchInputPlaceholder")}
            inputTestID="shell-workspace-search-input"
            cancelTestID="shell-workspace-search-cancel"
          />
        ) : (
          <>
            <Text style={styles.title}>{t("workspace.title")}</Text>
            <Pressable
              onPress={handleSearchOpen}
              accessibilityRole="search"
              style={styles.searchBar}
              testID="shell-workspace-search"
            >
              <Search size={15} color={styles.searchIcon.color} />
              <Text style={styles.searchPlaceholder} numberOfLines={1}>
                {t("workspace.searchPlaceholder")}
              </Text>
            </Pressable>
          </>
        )}
      </View>
      {body}
      <CommandWorkspacePickerSheet
        open={pickerCommand !== null}
        options={pickerOptions}
        onSelect={selectWorkspace}
        onClose={closePicker}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  header: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[3],
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: 44,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  searchIcon: {
    color: theme.colors.foregroundMuted,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  searchEmpty: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[4] * 4,
    paddingHorizontal: theme.spacing[6],
  },
  listContent: {
    paddingBottom: theme.spacing[8],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
  },
  sectionHeaderText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  favoritesEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginHorizontal: theme.spacing[4],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
  },
  favoritesEmptyIcon: {
    color: theme.colors.foregroundMuted,
  },
  favoritesEmptyText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  hostEmpty: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  worktreeEmpty: {
    paddingLeft: theme.spacing[4] + 18 + 22 + 22,
    paddingRight: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundExtraMuted,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  footer: {
    paddingTop: theme.spacing[2],
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  actionIconWrap: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIcon: {
    color: theme.colors.accent,
  },
  actionLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accent,
  },
  skeletonWrap: {
    flex: 1,
    paddingTop: theme.spacing[2],
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[2],
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
  },
  emptyTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  emptyHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    marginBottom: theme.spacing[2],
  },
  refreshTint: {
    color: theme.colors.accent,
  },
}));
