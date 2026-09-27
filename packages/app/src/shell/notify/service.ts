// C11 notification service (card ruling c-path): local expo-notifications for the
// shell. Two responsibilities:
//
// 1. Post — attention transitions become OS notifications. The official root layout
// installs a global setNotificationHandler that suppresses ALL foreground display
// (shouldShowBanner/List false — it exists for the official push channel). We install
// ours after it (shell layout mounts after the root layout's effects), presenting
// shell-marked notifications and reproducing the official suppression for everything
// else, so official pushes keep their exact behaviour. Background display needs no
// handler: the OS renders it from the HIGH-importance channel we create here.
//
// 2. Tap — responses route through the C4 open-intent channel (shellNavigateToAgent,
// push verb), never the official dismissTo family. The payload deliberately hides
// from the official router's key reader (see payload.ts), so its listener resolves
// our taps to its `/` fallback: on warm taps its navigate("/") runs first (listener
// registration order) and our push lands on top of the shell root — back returns to
// 对话. On cold start both sides read getLastNotificationResponseAsync (the native
// getter does NOT consume), so we delay our navigation past the official's redirect.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { shellNavigateToAgent } from "@/shell/chats/shell-navigate-to-agent";
import { chatLastEventAtFromAgent } from "@/shell/chats/derive";
import { recordVisit } from "@/shell/chats/visit-ledger";
import { useSessionStore } from "@/stores/session-store";
import { usePaseoGoReadStateStore } from "@/shell/stores/readState";
import { decodeAttentionPayload, encodeAttentionPayload, type AttentionPayload } from "./payload";

export const SHELL_NOTIFY_CHANNEL_ID = "paseo-go-attention";

/** Cold-start grace: let the official router's `/` redirect settle before pushing. */
const COLD_START_NAV_DELAY_MS = 700;

export interface AttentionNotificationContent {
  title: string;
  body: string;
  payload: AttentionPayload;
}

let started = false;
let lastHandledIdentifier: string | null = null;
let channelName = "Paseo Go";
let channelReady: Promise<unknown> | null = null;
let permissionReady: Promise<boolean> | null = null;

function ensureChannel(): Promise<unknown> {
  if (Platform.OS !== "android") return Promise.resolve();
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(SHELL_NOTIFY_CHANNEL_ID, {
      name: channelName,
      importance: Notifications.AndroidImportance.HIGH,
      // F7 (review): explicit — attention bodies must never extend on the lock
      // screen even under a future system default change.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).catch(() => null);
  }
  return channelReady;
}

/** Card ruling: the system permission is requested at the first trigger, once. */
function ensurePermission(): Promise<boolean> {
  if (!permissionReady) {
    permissionReady = (async () => {
      const existing = await Notifications.getPermissionsAsync();
      if (existing.status === Notifications.PermissionStatus.GRANTED) return true;
      if (!existing.canAskAgain) return false;
      const requested = await Notifications.requestPermissionsAsync();
      return requested.status === Notifications.PermissionStatus.GRANTED;
    })().catch(() => false);
  }
  return permissionReady;
}

function openFromResponse(response: Notifications.NotificationResponse): void {
  const identifier = response.notification.request.identifier;
  if (lastHandledIdentifier === identifier) return;
  const payload = decodeAttentionPayload(response.notification.request.content.data);
  if (!payload) return;
  lastHandledIdentifier = identifier;
  // The visit starts at the session itself — the chats row must not stay unread.
  // F4: stamp with the chat's own host-domain event time; an unloaded directory
  // (cold start) leaves the dot instead of writing a device-clock watermark that
  // would swallow every host event until the clocks cross.
  const agent = useSessionStore.getState().sessions[payload.serverId]?.agents.get(payload.agentId);
  // R2-14: chatLastEventAtFromAgent is null when the host's date strings are
  // garbage — leave the dot (the same no-bogus-watermark posture as an
  // unloaded directory) instead of writing NaN into the persisted store.
  const at = agent ? chatLastEventAtFromAgent(agent) : null;
  if (at !== null) {
    usePaseoGoReadStateStore.getState().markRead(`${payload.serverId}:${payload.agentId}`, at);
  }
  // R2-02 (通知进入): the tap IS a visit — record it on the module ledger so the
  // leave moments (rail switch / next open / focus-beat compensation) settle the
  // activity watched inside the session. No trustworthy entry stamp (cold tap)
  // still records, with floor 0: the session screen shows the full timeline, so
  // everything up to the settle moment was seen; the slot merely survives until
  // the directory row exists.
  recordVisit({
    section: "chats",
    key: `${payload.serverId}:${payload.agentId}`,
    serverId: payload.serverId,
    agentId: payload.agentId,
    at: at ?? 0,
  });
  shellNavigateToAgent(payload);
  void Notifications.dismissNotificationAsync(identifier).catch(() => {});
}

/** Idempotent; call from the shell layout mount. Safe to call on every remount. */
export function startShellNotifyService(channelNameArg: string): void {
  channelName = channelNameArg;
  void ensureChannel();
  if (started) return;
  started = true;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const mine = decodeAttentionPayload(notification.request.content.data) !== null;
      return {
        shouldShowAlert: mine,
        shouldShowBanner: mine,
        shouldShowList: mine,
        shouldPlaySound: mine,
        shouldSetBadge: false,
      };
    },
  });

  Notifications.addNotificationResponseReceivedListener(openFromResponse);

  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return null;
      return setTimeout(() => openFromResponse(response), COLD_START_NAV_DELAY_MS);
    })
    .catch(() => {});
}

/** Fire one attention notification; permission-gated, channel-bound. */
export function postAttentionNotification(content: AttentionNotificationContent): void {
  void (async () => {
    await ensureChannel();
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: content.title,
        body: content.body,
        data: encodeAttentionPayload(content.payload),
        sound: true,
        ...(Platform.OS === "android" ? { channelId: SHELL_NOTIFY_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  })().catch(() => {
    // A notification is a courtesy, never an error path for the list.
  });
}
