// 文件浏览屏 shared body (card C16, restructured by C27; KI-9 single instance):
// the UI behind the ONE route `(detail)/files/[serverId]/[workspaceId]` — a real
// root-Stack push (工作区 tree row / session capsule / deep link all land here),
// so back is a real pop and that wiring lives in the thin route wrapper, not
// here. (The C5 KI-2 hidden-tab twin and its in-tab back interception were
// retired by KI-9.)
// The wrapper also feeds the optional `tab` query param through `initialTab`
// (KI-9 菜单收敛) — an INITIAL value only: tab state stays in-screen (裁定 4:
// 不入 persist、不进后续 URL 状态).
// C27 (DESIGN §14.9): the header is a single project-path line (the host › project
// › workspace breadcrumb was 拍板没有意义), with a 放大镜 morphing into the KI-6
// two-tier search bar (全仓文件名 fuzzy + 内容兜底); below it a three-segment tab
// row 文件 | diff | git 记录 embeds the official ChangesSurface (the same component
// the official changes tab mounts, same queries/panel-store data path) and
// CommitsSection (checkout commits ahead of base). Tab/search state is in-screen
// only (裁定: 不入 persist). Panels stay mounted across tab switches (RetainedPanel
// — display:none + active-context gating), so 段切换往返状态不串: the explorer keeps
// its expansion/selection (scroll position may reset when Android recycles the
// list — accepted), the diff keeps its collapsed-file tree state (lifted here),
// commits keep their query cache. Non-git checkouts gray the two git segments and
// say why (official unsupported idiom: nothing to embed).
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ChevronLeft, FileQuestion, Search, SearchX, Star, StarOff, X } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { ChangesSurface } from "@/git/diff-pane";
import { CommitsSection } from "@/git/commits-section/commits-section";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { changesStateSchema, defaultChangesState, type ChangesState } from "@/panels/changes/state";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { RetainedPanel } from "@/components/retained-panel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type ExplorerEntry } from "@/stores/session-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { buildWorkspaceExplorerStateKey } from "@/file-explorer/state-keys";
import { parentExplorerPath } from "@/utils/explorer-paths";
import { SHELL_I18N_NAMESPACE } from "@/shell/i18n";
import { shellPreviewHref } from "@/shell/routes";
import {
  useShellAddToChat,
  useShellFileActions,
  type ShellFileTarget,
} from "@/shell/files/use-shell-file-actions";
import {
  buildWorkspaceFileSearchSource,
  constrainFilesScreenTab,
  gitTabsDisabled,
  type FilesScreenTab,
} from "@/shell/files/files-tabs";
import { SearchModeBar } from "@/shell/components/search/search-mode-bar";
import { FileSearchRow } from "@/shell/components/search/file-search-row";
import { ContentSearchRow } from "@/shell/components/search/content-search-row";
import { collectBrowsedWorkspaces, type FileSearchHit } from "@/shell/search/file-search";
import {
  useWorkspaceSearch,
  type ContentSearchHit,
  type WorkspaceSearchResult,
} from "@/shell/search/workspace-search";

// The official rows set selectedEntryPath on press AND long-press; the chip turns
// that selection into the shell's 收藏 affordance for the explorer surface.
function SelectionFavoriteChip({
  serverId,
  workspaceId,
  workspaceRoot,
  entry,
  onClear,
}: {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  entry: ExplorerEntry;
  onClear: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const target = useMemo<ShellFileTarget>(
    () => ({
      hostId: serverId,
      workspaceId,
      workspaceRoot,
      path: entry.path,
      name: entry.name,
      size: entry.size,
      mtime: entry.modifiedAt,
    }),
    [serverId, workspaceId, workspaceRoot, entry],
  );
  const { isFavorite, toggleFavorite } = useShellFileActions(target);
  return (
    <View style={styles.chipRow} testID="shell-files-selection-chip">
      <Text style={styles.chipName} numberOfLines={1}>
        {entry.name}
      </Text>
      <Pressable
        onPress={toggleFavorite}
        accessibilityRole="button"
        hitSlop={11}
        style={styles.chipButton}
        testID="shell-files-selection-favorite"
      >
        {isFavorite ? (
          <StarOff size={14} color={styles.chipIcon.color} />
        ) : (
          <Star size={14} color={styles.chipIcon.color} />
        )}
        <Text style={styles.chipLabel}>
          {t(isFavorite ? "files.menu.unfavorite" : "files.menu.favorite")}
        </Text>
      </Pressable>
      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        hitSlop={11}
        style={styles.chipButton}
        testID="shell-files-selection-clear"
      >
        <X size={14} color={styles.chipIcon.color} />
      </Pressable>
    </View>
  );
}

// C27: 头部只留项目路径 — one line (back · workspaceDirectory · 放大镜). Middle
// ellipsization keeps the tail segment (the part that identifies THIS checkout)
// visible on long paths. The 放大镜 morphs the row into the C9 search bar.
function FilesHeader({
  pathLabel,
  searchActive,
  onBack,
  onSearchOpen,
  onQueryChange,
  onSearchCancel,
  topInset,
}: {
  pathLabel: string;
  searchActive: boolean;
  onBack: () => void;
  onSearchOpen: () => void;
  onQueryChange: (query: string) => void;
  onSearchCancel: () => void;
  topInset: number;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={[styles.header, { paddingTop: topInset }]}>
      {searchActive ? (
        <SearchModeBar
          onQueryChange={onQueryChange}
          onCancel={onSearchCancel}
          placeholder={t("files.searchPlaceholder")}
          inputTestID="shell-files-search-input"
          cancelTestID="shell-files-search-cancel"
        />
      ) : (
        <>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.back}
            testID="shell-files-back"
          >
            <ChevronLeft size={22} color={styles.backIcon.color} />
          </Pressable>
          <Text
            style={styles.path}
            numberOfLines={1}
            ellipsizeMode="middle"
            accessibilityLabel={pathLabel}
            testID="shell-files-path"
          >
            {pathLabel}
          </Text>
          <Pressable
            onPress={onSearchOpen}
            accessibilityRole="search"
            hitSlop={8}
            style={styles.back}
            testID="shell-files-search"
          >
            <Search size={18} color={styles.backIcon.color} />
          </Pressable>
        </>
      )}
    </View>
  );
}

// 页内搜索空态 (KI-6 改写): the main 口径 is repo-wide (fuzzy file names, then
// content fallback), so the old 「只覆盖浏览过的目录」 note退位为 fallback 态说明 —
// it only shows while the Tier-1 RPC failed / the daemon is old. The miss line
// waits for `pending` (「没有匹配」 must never flash before the RPC lands). With
// an empty query the note leads alone.
function FilesSearchEmptyState({
  pending,
  fallback,
  onClear,
}: {
  pending: boolean;
  fallback: boolean;
  onClear: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  return (
    <View style={styles.searchEmpty} testID="shell-files-search-empty">
      {pending ? (
        <LoadingSpinner size="small" color={styles.chipIcon.color} />
      ) : (
        <>
          <SearchX size={28} color={styles.chipIcon.color} />
          <Text style={styles.searchEmptyTitle}>{t("files.searchEmptyTitle")}</Text>
          <Button variant="secondary" size="sm" onPress={onClear} testID="shell-files-search-clear">
            {t("files.searchEmptyAction")}
          </Button>
        </>
      )}
      <Text style={styles.missing}>
        {fallback ? t("files.searchFallbackHint") : t("files.searchEmptyHint")}
      </Text>
    </View>
  );
}

// git 记录段: the official CommitsSection (checkout history ahead of base, with
// its own skeleton/error/noneAhead states). Its rows only expose onPress and the
// body is off-limits to this card, so the commit-diff panel (which lives in the
// official workspace-tab layout this screen has no handle on) is NOT wired —
// pressing a row copies its full sha (C27 ruling's 降级, recorded in the card
// report). The capability gate reads the SAME serverInfo.features flags
// useCheckoutCommitsQuery gates on, so the section never renders as a blank pane.
function GitLogPane({
  serverId,
  cwd,
  onCommitPress,
}: {
  serverId: string;
  cwd: string;
  onCommitPress: (sha: string) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const [collapsed, setCollapsed] = useState(false);
  const commitsSupported = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.commitsList === true &&
      state.sessions[serverId]?.serverInfo?.features?.commitBaseClassification === true,
  );
  if (!commitsSupported) {
    return (
      <View style={styles.missingWrap} testID="shell-files-commits-unsupported">
        <Text style={styles.missing}>{t("files.commitsUnsupported")}</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.gitScroll} testID="shell-files-git-pane">
      <CommitsSection
        serverId={serverId}
        cwd={cwd}
        onCommitPress={onCommitPress}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
    </ScrollView>
  );
}

export function FilesScreenBody({
  serverId,
  workspaceId,
  initialTab = "files",
  onBack,
}: {
  serverId: string;
  workspaceId: string;
  /** KI-9: the wrapper's resolved `?tab=` — initial value only, see header. */
  initialTab?: FilesScreenTab;
  onBack: () => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const hosts = useHosts();
  const workspace = useSessionStore((state) =>
    serverId && workspaceId ? state.sessions[serverId]?.workspaces.get(workspaceId) : undefined,
  );
  // C12: entering files straight after connect (deep link / capsule) can beat the
  // workspace-descriptor wave — show the pane's loading idiom until the host's
  // workspace set has hydrated, so a cold first frame never misreports 「找不到」.
  const workspacesHydrated = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false,
  );

  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const rootPath = workspace?.workspaceDirectory || workspace?.projectRootPath || "";
  const workspaceName = workspace?.title?.trim() || workspace?.name || workspaceId;

  // ---- C27 三段页签 (in-screen state, 裁定 4: 不入 persist) --------------------
  // KI-9: seeded from `initialTab` (the wrapper's resolved `?tab=`); later URL
  // never changes it — the state machine below owns it from the first frame.
  const [tab, setTab] = useState<FilesScreenTab>(initialTab);
  // Panels lazy-mount on first visit and then stay mounted (RetainedPanel), so
  // tab round-trips never rebuild (and never re-fetch from zero) a pane. 文件
  // stays mounted from frame one: it is constrainFilesScreenTab's fallback
  // target when a diff/git entry meets a non-git checkout.
  const [visited, setVisited] = useState<Record<FilesScreenTab, boolean>>(() => ({
    files: true,
    diff: initialTab === "diff",
    git: initialTab === "git",
  }));
  const handleTabChange = useCallback((next: FilesScreenTab) => {
    setTab(next);
    setVisited((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
  }, []);
  // The SAME checkout status the embedded ChangesSurface reads (one query cache,
  // push-driven) — no second git-state source.
  const checkoutStatus = useCheckoutStatusQuery({ serverId, cwd: rootPath });
  const isGit = checkoutStatus.status ? checkoutStatus.status.isGit : null;
  const gitDisabled = gitTabsDisabled(isGit);
  // A non-git status landing while diff/git is open falls back to 文件 (pure fn).
  const activeTab = constrainFilesScreenTab(tab, isGit);
  const tabOptions = useMemo(
    () => [
      { value: "files" as const, label: t("files.tabFiles"), testID: "shell-files-tab-files" },
      {
        value: "diff" as const,
        label: t("files.tabDiff"),
        disabled: gitDisabled,
        testID: "shell-files-tab-diff",
      },
      {
        value: "git" as const,
        label: t("files.tabGit"),
        disabled: gitDisabled,
        testID: "shell-files-tab-git",
      },
    ],
    [t, gitDisabled],
  );

  // ---- 页内搜索 (KI-6 两层: 全仓文件名 fuzzy + 内容兜底) ------------------------
  const search = useFilesWorkspaceSearch({
    serverId,
    hostLabel,
    workspaceId,
    workspaceName,
    workspaceRoot: rootPath,
  });

  // ---- shared file wiring ------------------------------------------------------
  const workspaceStateKey = useMemo(
    () => buildWorkspaceExplorerStateKey({ workspaceId, workspaceRoot: rootPath }),
    [workspaceId, rootPath],
  );
  const explorerState = useSessionStore((state) =>
    serverId && workspaceStateKey
      ? state.sessions[serverId]?.fileExplorer.get(workspaceStateKey)
      : undefined,
  );
  const { selectExplorerEntry } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: rootPath,
  });
  const selectedEntry = useMemo<ExplorerEntry | null>(() => {
    const selectedPath = explorerState?.selectedEntryPath;
    if (!explorerState || !selectedPath) return null;
    const directory = explorerState.directories.get(parentExplorerPath(selectedPath));
    const entry = directory?.entries.find((candidate) => candidate.path === selectedPath);
    return entry?.kind === "file" ? entry : null;
  }, [explorerState]);

  const handleOpenFile = useCallback(
    (path: string) => {
      router.push(
        shellPreviewHref({
          serverId,
          workspaceId,
          path,
          name: path.split(/[/\\]/).pop() ?? path,
          workspaceRoot: rootPath,
        }) as Href,
      );
    },
    [serverId, workspaceId, rootPath],
  );
  const handleOpenHit = useCallback(
    (hit: FileSearchHit) => handleOpenFile(hit.path),
    [handleOpenFile],
  );
  // KI-6 Tier-2: matches.path is workspace-relative "/"-separated — the same
  // preview contract as an explorer hit. 行定位 is NOT wired (FilePane takes no
  // line param; known_issue KI-6-line-target): the file opens at its top.
  const handleOpenContentHit = useCallback(
    (hit: ContentSearchHit) => handleOpenFile(hit.path),
    [handleOpenFile],
  );
  const addToChat = useShellAddToChat();
  const handleAddToChat = useCallback(
    (path: string) => {
      void addToChat({
        hostId: serverId,
        workspaceId,
        workspaceRoot: rootPath,
        path,
        name: path.split(/[/\\]/).pop() ?? path,
      });
    },
    [addToChat, serverId, workspaceId, rootPath],
  );
  const handleClearSelection = useCallback(() => selectExplorerEntry(null), [selectExplorerEntry]);

  // diff 段: the ChangesSurface state the official sidebar lifts the same way
  // (collapsed file/folder paths survive tab round-trips; the pane itself owns
  // everything else through the official queries).
  const [changesState, setChangesState] = useState<ChangesState>(() =>
    changesStateSchema.parse(defaultChangesState),
  );
  const handleCommitPress = useCallback(
    (sha: string) => {
      void (async () => {
        try {
          await Clipboard.setStringAsync(sha);
          toast.show(t("files.commitShaCopied", { sha: sha.slice(0, 8) }));
        } catch {
          toast.error(t("files.commitCopyFailed"));
        }
      })();
    },
    [toast, t],
  );

  const hasWorkspace = workspace !== undefined;

  return (
    <View style={styles.screen}>
      <FilesHeader
        pathLabel={rootPath || workspaceName}
        searchActive={search.active}
        onBack={onBack}
        onSearchOpen={search.open}
        onQueryChange={search.setQuery}
        onSearchCancel={search.cancel}
        topInset={insets.top + 8}
      />
      <View style={styles.tabRow}>
        <SegmentedControl
          size="sm"
          options={tabOptions}
          value={activeTab}
          onValueChange={handleTabChange}
          testID="shell-files-tabs"
        />
      </View>
      {gitDisabled ? (
        <Text style={styles.notGitHint} testID="shell-files-not-git-hint">
          {t("files.notGitHint")}
        </Text>
      ) : null}
      <View style={styles.body}>
        {search.active ? (
          // 结果替换内容区 (C9 ruling): the retained panels go display:none (state
          // survives), the hit list takes over the body.
          <FilesSearchBody
            result={search.result}
            onClear={search.cancel}
            onOpenHit={handleOpenHit}
            onOpenContentHit={handleOpenContentHit}
          />
        ) : null}
        <FilesTabPanels
          visited={visited}
          activeTab={activeTab}
          searchActive={search.active}
          serverId={serverId}
          workspaceId={workspaceId}
          rootPath={rootPath}
          hasWorkspace={hasWorkspace}
          workspacesHydrated={workspacesHydrated}
          notFoundLabel={t("files.notFound")}
          selectedEntry={selectedEntry}
          changesState={changesState}
          onChangesStateChange={setChangesState}
          onClearSelection={handleClearSelection}
          onOpenFile={handleOpenFile}
          onAddToChat={handleAddToChat}
          onCommitPress={handleCommitPress}
        />
      </View>
    </View>
  );
}

// 页内搜索 state (KI-6 两层, in-screen only 不入 persist): Tier-1 = repo-wide
// fuzzy file names via the existing directory_suggestions RPC (cwd = workspace
// root, gitignore-aware, entries relative to cwd); Tier-2 = the workspace
// content_search RPC, auto-fired only on a zero-hit name layer and gated on its
// rpc_error; the C9/C13-F1 browsed-directory index (rebuilt from the session-
// store explorer cache while the bar is open) is the Tier-1-failure fallback.
// The RPC pipeline + seq guard live in useWorkspaceSearch (unit-tested).
function useFilesWorkspaceSearch(input: {
  serverId: string;
  hostLabel: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
}) {
  const { serverId, hostLabel, workspaceId, workspaceName, workspaceRoot } = input;
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const fileExplorer = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.fileExplorer : undefined,
  );
  const fallbackSource = useMemo(
    () =>
      active && fileExplorer
        ? buildWorkspaceFileSearchSource({
            serverId,
            hostLabel,
            workspaceId,
            workspaceName,
            workspaceRoot,
            browsed: collectBrowsedWorkspaces(fileExplorer),
          })
        : null,
    [active, fileExplorer, serverId, hostLabel, workspaceId, workspaceName, workspaceRoot],
  );
  const client = useHostRuntimeClient(serverId);
  const ctx = useMemo(
    () => ({ serverId, hostLabel, workspaceId, workspaceName, workspaceRoot }),
    [serverId, hostLabel, workspaceId, workspaceName, workspaceRoot],
  );
  const result = useWorkspaceSearch({ active, query, client, fallbackSource, ctx });
  const open = useCallback(() => setActive(true), []);
  const cancel = useCallback(() => {
    setActive(false);
    setQuery("");
  }, []);
  return { active, query, setQuery, open, cancel, result };
}

// 命中列表 (KI-6): takes over the body area while search is open. 文件名 hits are
// the FlatList itself (a hit pushes the C6 preview, same route as an explorer
// tap); the 内容 section rides the footer with its 「文件内容 · N」 title, the
// truncated/pending hints, and the fallback banner above both when the name
// layer degraded to the browsed index. The empty state only speaks when BOTH
// layers came up empty.
function FilesSearchBody({
  result,
  onClear,
  onOpenHit,
  onOpenContentHit,
}: {
  result: WorkspaceSearchResult;
  onClear: () => void;
  onOpenHit: (hit: FileSearchHit) => void;
  onOpenContentHit: (hit: ContentSearchHit) => void;
}) {
  const { t } = useTranslation(SHELL_I18N_NAMESPACE);
  const renderRow = useCallback(
    ({ item }: { item: FileSearchHit }) => <FileSearchRow hit={item} onOpen={onOpenHit} />,
    [onOpenHit],
  );
  const keyExtractor = useCallback((hit: FileSearchHit) => hit.key, []);
  const listHeader = useMemo(
    () =>
      result.fallback ? (
        <Text style={styles.searchFallbackBanner} testID="shell-files-search-fallback">
          {t("files.searchFallbackHint")}
        </Text>
      ) : null,
    [result.fallback, t],
  );
  const contentSection = useMemo(
    () =>
      result.contentPending || result.contentHits.length > 0 ? (
        <View testID="shell-files-search-content">
          <Text style={styles.searchSectionTitle}>
            {t("files.searchContentTitle", { count: result.contentHits.length })}
          </Text>
          {result.contentTruncated ? (
            <Text style={styles.searchSectionHint}>{t("files.searchContentTruncated")}</Text>
          ) : null}
          {result.contentPending ? (
            <Text style={styles.searchSectionHint}>{t("files.searchContentPending")}</Text>
          ) : null}
          {result.contentHits.map((hit) => (
            <ContentSearchRow key={hit.key} hit={hit} onOpen={onOpenContentHit} />
          ))}
        </View>
      ) : null,
    [result.contentHits, result.contentPending, result.contentTruncated, onOpenContentHit, t],
  );
  const bothEmpty =
    result.nameHits.length === 0 && result.contentHits.length === 0 && !result.contentPending;
  const listEmpty = useMemo(
    () =>
      bothEmpty ? (
        <FilesSearchEmptyState
          pending={result.pending}
          fallback={result.fallback}
          onClear={onClear}
        />
      ) : null,
    [bothEmpty, result.pending, result.fallback, onClear],
  );
  return (
    <FlatList
      data={result.nameHits}
      keyExtractor={keyExtractor}
      renderItem={renderRow}
      contentContainerStyle={styles.searchListContent}
      ListHeaderComponent={listHeader}
      ListFooterComponent={contentSection}
      ListEmptyComponent={listEmpty}
      testID="shell-files-search-results"
    />
  );
}

// 三段内容区: each VISITED panel stays mounted across switches (RetainedPanel —
// display:none + active-context gating, the official sidebar idiom), so 段切换
// 往返状态不串: the explorer keeps expansion/selection (scroll position may reset
// when Android recycles the offscreen list — accepted), the diff keeps its lifted
// collapsed-tree state, commits keep their query cache; inactive panels also lose
// the retained-active signal, which pauses their timers/polling upstream.
// A not-yet-hydrated / missing descriptor reuses the C12 three-state idiom in
// EVERY segment, so no segment can flash a misleading empty diff.
function FilesTabPanels({
  visited,
  activeTab,
  searchActive,
  serverId,
  workspaceId,
  rootPath,
  hasWorkspace,
  workspacesHydrated,
  notFoundLabel,
  selectedEntry,
  changesState,
  onChangesStateChange,
  onClearSelection,
  onOpenFile,
  onAddToChat,
  onCommitPress,
}: {
  visited: Record<FilesScreenTab, boolean>;
  activeTab: FilesScreenTab;
  searchActive: boolean;
  serverId: string;
  workspaceId: string;
  rootPath: string;
  hasWorkspace: boolean;
  workspacesHydrated: boolean;
  notFoundLabel: string;
  selectedEntry: ExplorerEntry | null;
  changesState: ChangesState;
  onChangesStateChange: (state: ChangesState) => void;
  onClearSelection: () => void;
  onOpenFile: (path: string) => void;
  onAddToChat: (path: string) => void;
  onCommitPress: (sha: string) => void;
}) {
  const diffActive = activeTab === "diff" && !searchActive;
  return (
    <View style={[styles.panels, searchActive && styles.panelsHidden]}>
      <RetainedPanel active={activeTab === "files" && !searchActive}>
        {selectedEntry ? (
          <SelectionFavoriteChip
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={rootPath}
            entry={selectedEntry}
            onClear={onClearSelection}
          />
        ) : null}
        <FilesPaneState
          serverId={serverId}
          workspaceId={workspaceId}
          rootPath={rootPath}
          hasWorkspace={hasWorkspace}
          workspacesHydrated={workspacesHydrated}
          notFoundLabel={notFoundLabel}
          onOpenFile={onOpenFile}
          onAddToChat={onAddToChat}
        />
      </RetainedPanel>
      {visited.diff ? (
        <RetainedPanel active={diffActive}>
          {hasWorkspace && serverId ? (
            <ChangesSurface
              serverId={serverId}
              workspaceId={workspaceId}
              cwd={rootPath}
              enabled={diffActive}
              onOpenFile={onOpenFile}
              onAddToChat={onAddToChat}
              state={changesState}
              onStateChange={onChangesStateChange}
            />
          ) : (
            <FilesPaneState
              serverId={serverId}
              workspaceId={workspaceId}
              rootPath={rootPath}
              hasWorkspace={false}
              workspacesHydrated={workspacesHydrated}
              notFoundLabel={notFoundLabel}
              onOpenFile={onOpenFile}
              onAddToChat={onAddToChat}
            />
          )}
        </RetainedPanel>
      ) : null}
      {visited.git ? (
        <RetainedPanel active={activeTab === "git" && !searchActive}>
          {hasWorkspace && serverId ? (
            <GitLogPane serverId={serverId} cwd={rootPath} onCommitPress={onCommitPress} />
          ) : (
            <FilesPaneState
              serverId={serverId}
              workspaceId={workspaceId}
              rootPath={rootPath}
              hasWorkspace={false}
              workspacesHydrated={workspacesHydrated}
              notFoundLabel={notFoundLabel}
              onOpenFile={onOpenFile}
              onAddToChat={onAddToChat}
            />
          )}
        </RetainedPanel>
      ) : null}
    </View>
  );
}

// Three-state body (C12): descriptor synced → official pane; workspace set still
// hydrating → loading; hydrated but the workspace is gone → icon + notFound.
// A component with early returns instead of a nested ternary (lint rule).
function FilesPaneState({
  serverId,
  workspaceId,
  rootPath,
  hasWorkspace,
  workspacesHydrated,
  notFoundLabel,
  onOpenFile,
  onAddToChat,
}: {
  serverId: string;
  workspaceId: string;
  rootPath: string;
  hasWorkspace: boolean;
  workspacesHydrated: boolean;
  notFoundLabel: string;
  onOpenFile: (path: string) => void;
  onAddToChat: (path: string) => void;
}) {
  if (hasWorkspace && serverId)
    return (
      <FileExplorerPane
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceRoot={rootPath}
        onOpenFile={onOpenFile}
        onAddToChat={onAddToChat}
      />
    );
  if (serverId && !workspacesHydrated)
    return (
      <View style={styles.loading} testID="shell-files-loading">
        <LoadingSpinner size="small" color={styles.chipIcon.color} />
      </View>
    );
  return (
    <View style={styles.missingWrap} testID="shell-files-missing">
      <FileQuestion size={28} color={styles.chipIcon.color} />
      <Text style={styles.missing}>{notFoundLabel}</Text>
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
    gap: theme.spacing[1],
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
  path: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  notGitHint: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  chipName: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  chipButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  chipIcon: {
    color: theme.colors.foregroundMuted,
  },
  chipLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  body: {
    flex: 1,
  },
  panels: {
    flex: 1,
  },
  panelsHidden: {
    display: "none",
  },
  gitScroll: {
    flex: 1,
  },
  searchListContent: {
    paddingBottom: theme.spacing[6],
  },
  searchFallbackBanner: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusWarning,
  },
  searchSectionTitle: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foregroundMuted,
  },
  searchSectionHint: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  searchEmpty: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[4] * 4,
    paddingHorizontal: theme.spacing[6],
  },
  searchEmptyTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  missingWrap: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[8] * 2,
    paddingHorizontal: theme.spacing[6],
  },
  missing: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
