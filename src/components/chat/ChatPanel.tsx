"use client";

import { useState, useCallback } from "react";
import { MessageSquare } from "lucide-react";
import { useChatContext } from "@/components/ChatProvider";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import TypingIndicator from "./TypingIndicator";
import ProfilePanel from "./ProfilePanel";
import GroupInfoPanel from "./GroupInfoPanel";
import type { Message } from "@/lib/types";

const GROUP_TYPES = new Set(["group", "school_class", "business_channel", "support", "b2b"]);

export default function ChatPanel() {
  const { activeConversationId, activeConversation, currentUserId, sendMessage } = useChatContext();
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const handleReply = useCallback((message: Message) => {
    setReplyTo(message);
  }, []);

  const clearReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  if (!activeConversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-950">
        <div className="w-20 h-20 rounded-2xl bg-gray-800/50 flex items-center justify-center mb-5">
          <MessageSquare size={36} className="text-gray-700" />
        </div>
        <h3 className="text-lg font-medium text-gray-400 mb-1">
          Peeap Chat
        </h3>
        <p className="text-sm text-gray-600 max-w-xs text-center">
          Select a conversation to start messaging, or create a new chat.
        </p>
      </div>
    );
  }

  const isGroup = GROUP_TYPES.has(activeConversation?.type || "");
  const otherUserId =
    activeConversation?.type === "direct"
      ? activeConversation.members?.find((m) => m.user_id !== currentUserId)?.user_id
      : null;

  return (
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 flex flex-col bg-gray-950 min-w-0">
        <ChatHeader onProfileClick={() => setShowInfoPanel(!showInfoPanel)} />
        <MessageList onReply={handleReply} />
        <TypingIndicator />
        <MessageInput replyTo={replyTo} onClearReply={clearReply} />
      </div>

      {/* Info panel — group or direct */}
      {showInfoPanel && isGroup && (
        <GroupInfoPanel onClose={() => setShowInfoPanel(false)} />
      )}
      {showInfoPanel && !isGroup && otherUserId && (
        <ProfilePanel
          userId={otherUserId}
          onClose={() => setShowInfoPanel(false)}
          onSendProduct={(productId) => {
            sendMessage(`/product ${productId}`, "text");
            setShowInfoPanel(false);
          }}
        />
      )}
    </div>
  );
}
