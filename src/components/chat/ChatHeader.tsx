"use client";

import {
  ArrowLeft,
  Phone,
  Video,
  MoreVertical,
  Users,
  Shield,
  Crown,
} from "lucide-react";
import { useChatContext } from "@/components/ChatProvider";
import Avatar from "@/components/ui/Avatar";
import {
  getConversationName,
  getConversationAvatar,
  getUserDisplayName,
} from "@/lib/utils";

interface ChatHeaderProps {
  onProfileClick?: () => void;
}

export default function ChatHeader({ onProfileClick }: ChatHeaderProps) {
  const {
    activeConversation: conv,
    currentUserId,
    setShowSidebar,
  } = useChatContext();

  if (!conv) return null;

  const name = getConversationName(conv, currentUserId);
  const avatar = getConversationAvatar(conv, currentUserId);
  const isGroup =
    conv.type === "group" ||
    conv.type === "school_class" ||
    conv.type === "business_channel";

  const memberNames = isGroup
    ? conv.members
        ?.slice(0, 3)
        .map((m) => getUserDisplayName(m.profile))
        .join(", ") + (conv.member_count > 3 ? ` +${conv.member_count - 3}` : "")
    : null;

  // For direct chats, show last seen
  const otherMember = conv.type === "direct"
    ? conv.members?.find((m) => m.user_id !== currentUserId)
    : null;

  return (
    <div className="h-16 px-4 flex items-center gap-3 border-b border-gray-800/80 bg-gray-900/50 shrink-0">
      {/* Back button (mobile) */}
      <button
        onClick={() => setShowSidebar(true)}
        className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400"
      >
        <ArrowLeft size={20} />
      </button>

      <button
        onClick={onProfileClick}
        className="flex items-center gap-3 flex-1 min-w-0 hover:bg-gray-800/30 -ml-1 pl-1 pr-2 py-1 rounded-lg transition-colors"
      >
        <Avatar src={avatar} name={name} id={conv.id} size="md" />

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-white truncate">{name}</h2>
          {conv.type === "support" && (
            <Shield size={13} className="text-amber-400 shrink-0" />
          )}
          {conv.type === "business_channel" && (
            <Crown size={13} className="text-violet-400 shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-gray-500 truncate">
          {isGroup ? (
            <>
              <Users size={10} className="inline mr-1" />
              {conv.member_count} members
              {memberNames ? ` — ${memberNames}` : ""}
            </>
          ) : otherMember?.profile?.last_seen_at ? (
            "Active recently"
          ) : (
            conv.type === "direct" ? "Offline" : ""
          )}
        </p>
        </div>
      </button>

      <div className="flex items-center gap-1">
        <button
          className="p-2 rounded-lg text-gray-600 cursor-not-allowed opacity-40"
          title="Voice call (coming soon)"
          disabled
        >
          <Phone size={18} />
        </button>
        <button
          className="p-2 rounded-lg text-gray-600 cursor-not-allowed opacity-40"
          title="Video call (coming soon)"
          disabled
        >
          <Video size={18} />
        </button>
        <button
          onClick={onProfileClick}
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 transition-colors"
        >
          <MoreVertical size={18} />
        </button>
      </div>
    </div>
  );
}
