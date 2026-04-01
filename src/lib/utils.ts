import { format, isToday, isYesterday, isThisYear } from "date-fns";
import type { Conversation, ChatUser } from "./types";

export function formatMessageTime(dateStr: string): string {
  const d = new Date(dateStr);
  return format(d, "h:mm a");
}

export function formatConversationTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

export function formatDateSeparator(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (isThisYear(d)) return format(d, "EEEE, MMMM d");
  return format(d, "MMMM d, yyyy");
}

export function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function getConversationName(
  conv: Conversation,
  currentUserId: string
): string {
  if (conv.name) return conv.name;
  if (conv.type === "direct") {
    const other = conv.members?.find((m) => m.user_id !== currentUserId);
    if (other?.profile?.display_name) return other.profile.display_name;
  }
  if (conv.type === "group") return "Group Chat";
  if (conv.type === "support") return "Support";
  return "Conversation";
}

export function getConversationAvatar(
  conv: Conversation,
  currentUserId: string
): string | null {
  if (conv.type === "direct") {
    const other = conv.members?.find((m) => m.user_id !== currentUserId);
    return other?.profile?.avatar_url ?? null;
  }
  return null;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function getAvatarColor(id: string): string {
  const colors = [
    "bg-indigo-600",
    "bg-emerald-600",
    "bg-amber-600",
    "bg-rose-600",
    "bg-cyan-600",
    "bg-violet-600",
    "bg-orange-600",
    "bg-teal-600",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function getLastMessagePreview(conv: Conversation): string {
  if (!conv.last_message_content) return "";
  if (conv.last_message_type && conv.last_message_type !== "text") {
    const labels: Record<string, string> = {
      image: "Sent a photo",
      file: "Sent a file",
      audio: "Sent a voice message",
      video: "Sent a video",
      payment_request: "Payment request",
      payment_confirmation: "Payment confirmed",
      invoice: "Sent an invoice",
      receipt: "Sent a receipt",
      location: "Shared a location",
      contact: "Shared a contact",
      sticker: "Sent a sticker",
      system: conv.last_message_content,
      announcement: conv.last_message_content,
    };
    return labels[conv.last_message_type] ?? conv.last_message_content;
  }
  return conv.last_message_content;
}

export function formatCurrency(amount: number, currency: string = "SLE"): string {
  return `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getUserDisplayName(user?: ChatUser | null): string {
  return user?.display_name ?? "Unknown User";
}
