"use client";

import { useEffect, useState, useRef } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useChatContext } from "@/components/ChatProvider";

interface TypingUser {
  userId: string;
  name: string;
  startedAt: number;
}

const TYPING_TIMEOUT = 4000; // 4 seconds

export function useTypingBroadcast() {
  const { activeConversationId, currentUserId, currentUser } = useChatContext();
  const lastSent = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendChannelRef = useRef<any>(null);

  // Create ONE subscribed broadcast channel per conversation and reuse it.
  // Previously every keystroke called supabase.channel(...) which allocated a
  // brand-new RealtimeChannel (never removed, never subscribed) — over a
  // session this leaked hundreds of orphaned channels and the unsubscribed
  // .send() wasn't reliably delivered.
  useEffect(() => {
    if (!activeConversationId) return;

    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    const channel = supabase.channel(`typing:${activeConversationId}`);
    channel.subscribe();
    sendChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      sendChannelRef.current = null;
    };
  }, [activeConversationId]);

  function broadcastTyping() {
    if (!activeConversationId || !currentUserId) return;

    const now = Date.now();
    if (now - lastSent.current < 2000) return; // Debounce 2s
    lastSent.current = now;

    const channel = sendChannelRef.current;
    if (!channel) return;

    channel.send({
      type: "broadcast",
      event: "typing",
      payload: {
        userId: currentUserId,
        name: currentUser?.display_name || "Someone",
      },
    });
  }

  return { broadcastTyping };
}

export default function TypingIndicator() {
  const { activeConversationId, currentUserId } = useChatContext();
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!activeConversationId) return;

    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    const channel = supabase
      .channel(`typing:${activeConversationId}`)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.userId === currentUserId) return;

        const { userId, name } = payload as { userId: string; name: string };

        setTypingUsers((prev) => {
          const exists = prev.find((u) => u.userId === userId);
          if (exists) {
            return prev.map((u) =>
              u.userId === userId ? { ...u, startedAt: Date.now() } : u
            );
          }
          return [...prev, { userId, name, startedAt: Date.now() }];
        });

        // Clear existing timer for this user
        const existing = timersRef.current.get(userId);
        if (existing) clearTimeout(existing);

        // Set removal timer
        timersRef.current.set(
          userId,
          setTimeout(() => {
            setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
            timersRef.current.delete(userId);
          }, TYPING_TIMEOUT)
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
      setTypingUsers([]);
    };
  }, [activeConversationId, currentUserId]);

  if (typingUsers.length === 0) return null;

  const text =
    typingUsers.length === 1
      ? `${typingUsers[0].name} is typing`
      : typingUsers.length === 2
      ? `${typingUsers[0].name} and ${typingUsers[1].name} are typing`
      : `${typingUsers[0].name} and ${typingUsers.length - 1} others are typing`;

  return (
    <div className="px-4 py-1.5 shrink-0">
      <div className="flex items-center gap-2">
        {/* Animated dots */}
        <div className="flex gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
        </div>
        <span className="text-[11px] text-gray-500">{text}</span>
      </div>
    </div>
  );
}
