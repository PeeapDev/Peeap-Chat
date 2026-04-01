// ============================================================
// Browser notifications + tab unread badge
// ============================================================

let permission: NotificationPermission = "default";

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") {
    permission = "granted";
    return true;
  }
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  permission = result;
  return result === "granted";
}

export function showNotification(
  title: string,
  body: string,
  opts?: { icon?: string; tag?: string; onClick?: () => void }
) {
  if (permission !== "granted") return;
  if (document.hasFocus()) return; // Don't notify if tab is active

  const n = new Notification(title, {
    body,
    icon: opts?.icon || "/icon-192.png",
    tag: opts?.tag || "peeap-chat",
    silent: false,
  });

  if (opts?.onClick) {
    n.onclick = () => {
      window.focus();
      opts.onClick!();
      n.close();
    };
  }

  // Auto-close after 5s
  setTimeout(() => n.close(), 5000);
}

// ── Tab title unread badge ───────────────────────────────────

const BASE_TITLE = "Peeap Chat";
let currentUnread = 0;

export function updateTabBadge(unreadCount: number) {
  currentUnread = unreadCount;
  if (typeof document === "undefined") return;

  if (unreadCount > 0) {
    document.title = `(${unreadCount > 99 ? "99+" : unreadCount}) ${BASE_TITLE}`;
  } else {
    document.title = BASE_TITLE;
  }
}

// ── New message sound ────────────────────────────────────────

let audioCtx: AudioContext | null = null;

export function playMessageSound() {
  if (document.hasFocus()) return; // Only when tab is not focused

  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.2);
  } catch {
    // Audio not available
  }
}
