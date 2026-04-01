"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { useChatContext } from "@/components/ChatProvider";
import MessageBubble from "@/components/chat/MessageBubble";
import { formatDateSeparator, isSameDay } from "@/lib/utils";
import type { Message } from "@/lib/types";

interface MessageListProps {
  onReply: (message: Message) => void;
}

export default function MessageList({ onReply }: MessageListProps) {
  const {
    messages,
    loadingMessages,
    hasMoreMessages,
    loadMoreMessages,
    currentUserId,
    activeConversation,
    deleteMessage,
    editMessage,
    token,
  } = useChatContext();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const prevMessageCount = useRef(0);

  const isGroupChat =
    activeConversation?.type === "group" ||
    activeConversation?.type === "school_class" ||
    activeConversation?.type === "business_channel";

  // Build a lookup for reply-to messages
  const messageMap = useMemo(() => {
    const map = new Map<string, Message>();
    for (const msg of messages) {
      map.set(msg.id, msg);
    }
    return map;
  }, [messages]);

  // Handle reactions
  const handleReact = useCallback(
    async (messageId: string, emoji: string) => {
      if (!token) return;
      try {
        await fetch(`/api/messages/${messageId}/reactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ emoji }),
        });
      } catch {
        // silent
      }
    },
    [token]
  );

  // Auto-scroll on new messages
  useEffect(() => {
    const isNew = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;

    if (!isNew) return;

    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Initial scroll to bottom
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      bottomRef.current?.scrollIntoView();
    }
  }, [loadingMessages, activeConversation?.id]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    setShowScrollDown(!nearBottom && messages.length > 10);

    if (el.scrollTop < 60 && hasMoreMessages && !loadingMessages) {
      loadMoreMessages();
    }
  }, [hasMoreMessages, loadingMessages, loadMoreMessages, messages.length]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-3 space-y-1 scrollbar-thin"
      >
        {loadingMessages && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <Loader2 size={20} className="animate-spin text-gray-500" />
          </div>
        )}

        {!loadingMessages && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">No messages yet</p>
            <p className="text-gray-600 text-xs mt-1">
              Send a message to start the conversation
            </p>
          </div>
        )}

        {loadingMessages && messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={28} className="animate-spin text-indigo-500" />
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const showDate = !prev || !isSameDay(prev.created_at, msg.created_at);
          const showSender =
            !prev || prev.sender_id !== msg.sender_id || showDate;

          const replyTo = msg.reply_to ? messageMap.get(msg.reply_to) ?? null : null;

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex items-center justify-center my-4">
                  <span className="bg-gray-800/60 text-gray-500 text-[11px] font-medium px-3 py-1 rounded-full">
                    {formatDateSeparator(msg.created_at)}
                  </span>
                </div>
              )}

              <div className={showSender && i > 0 ? "mt-3" : "mt-0.5"}>
                <MessageBubble
                  message={msg}
                  isOwn={msg.sender_id === currentUserId}
                  showSender={showSender}
                  isGroupChat={isGroupChat}
                  onDelete={deleteMessage}
                  onEdit={editMessage}
                  onReply={onReply}
                  onReact={handleReact}
                  replyToMessage={replyTo}
                />
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {showScrollDown && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 p-2 bg-gray-800 border border-gray-700 rounded-full shadow-lg hover:bg-gray-700 transition-colors"
        >
          <ArrowDown size={18} className="text-gray-300" />
        </button>
      )}
    </div>
  );
}
