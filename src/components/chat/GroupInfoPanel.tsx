"use client";

import { useState, useEffect } from "react";
import {
  X,
  Users,
  Crown,
  Shield,
  UserPlus,
  UserMinus,
  Settings,
  LogOut,
  Loader2,
  Search,
} from "lucide-react";
import { useChatContext } from "@/components/ChatProvider";
import Avatar from "@/components/ui/Avatar";
import { getUserDisplayName, getConversationName } from "@/lib/utils";
import { chatAPI } from "@/lib/api";
import type { ChatUser, ConversationMember } from "@/lib/types";

interface GroupInfoPanelProps {
  onClose: () => void;
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  owner: <Crown size={12} className="text-amber-400" />,
  admin: <Shield size={12} className="text-indigo-400" />,
  moderator: <Shield size={12} className="text-cyan-400" />,
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Mod",
  member: "",
  observer: "Observer",
};

export default function GroupInfoPanel({ onClose }: GroupInfoPanelProps) {
  const { activeConversation, currentUserId, token } = useChatContext();
  const [showAddMember, setShowAddMember] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  if (!activeConversation) return null;

  const conv = activeConversation;
  const name = getConversationName(conv, currentUserId);
  const members = conv.members || [];
  const myRole = members.find((m) => m.user_id === currentUserId)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  // Sort: owner first, then admin, then everyone else
  const sortedMembers = [...members].sort((a, b) => {
    const order: Record<string, number> = { owner: 0, admin: 1, moderator: 2, member: 3, observer: 4 };
    return (order[a.role] ?? 5) - (order[b.role] ?? 5);
  });

  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await chatAPI.searchUsers(q, 10);
      const existingIds = new Set(members.map((m) => m.user_id));
      setSearchResults(
        (data.users || []).filter((u) => !existingIds.has(u.id))
      );
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function addMember(userId: string) {
    if (!conv) return;
    setAdding(true);
    try {
      await chatAPI.addMembers(conv.id, [userId]);
      setSearchQuery("");
      setSearchResults([]);
      setShowAddMember(false);
    } catch {
      // silent
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(userId: string) {
    if (!conv || !canManage) return;
    try {
      await chatAPI.removeMember(conv.id, [userId]);
    } catch {
      // silent
    }
  }

  return (
    <div className="w-80 lg:w-96 border-l border-gray-800 bg-gray-900 flex flex-col h-full shrink-0 overflow-hidden">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-gray-800 shrink-0">
        <h3 className="text-sm font-semibold text-white">Group Info</h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Group avatar + name */}
        <div className="flex flex-col items-center pt-6 pb-4 px-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4">
            <Users size={32} className="text-white" />
          </div>
          <h2 className="text-lg font-semibold text-white text-center">{name}</h2>
          <p className="text-xs text-gray-500 mt-1">
            {conv.type === "group" ? "Group" : conv.type.replace(/_/g, " ")} · {conv.member_count} members
          </p>
          {conv.is_announcement_only && (
            <span className="mt-2 text-[11px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
              Announcement only
            </span>
          )}
        </div>

        {/* Members */}
        <div className="px-4 py-3 border-t border-gray-800/50">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
              Members ({members.length})
            </p>
            {canManage && (
              <button
                onClick={() => setShowAddMember(!showAddMember)}
                className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
              >
                <UserPlus size={12} />
                Add
              </button>
            )}
          </div>

          {/* Add member search */}
          {showAddMember && (
            <div className="mb-3">
              <div className="relative mb-2">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search users to add..."
                  className="w-full bg-gray-800 border border-gray-700/50 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
              </div>
              {searching && (
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-500">
                  <Loader2 size={12} className="animate-spin" /> Searching...
                </div>
              )}
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => addMember(user.id)}
                  disabled={adding}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Avatar src={user.avatar_url} name={user.display_name} id={user.id} size="sm" />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs text-white truncate">{user.display_name}</p>
                    <p className="text-[10px] text-gray-500">{user.email || user.phone}</p>
                  </div>
                  <span className="text-[10px] text-indigo-400">Add</span>
                </button>
              ))}
            </div>
          )}

          {/* Member list */}
          <div className="space-y-0.5">
            {sortedMembers.map((member) => (
              <div
                key={member.user_id}
                className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-800/50 group"
              >
                <Avatar
                  src={member.profile?.avatar_url}
                  name={getUserDisplayName(member.profile)}
                  id={member.user_id}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-white truncate">
                      {getUserDisplayName(member.profile)}
                      {member.user_id === currentUserId && (
                        <span className="text-gray-500 ml-1">(you)</span>
                      )}
                    </p>
                    {ROLE_ICONS[member.role]}
                  </div>
                  {ROLE_LABELS[member.role] && (
                    <p className="text-[10px] text-gray-500">{ROLE_LABELS[member.role]}</p>
                  )}
                </div>
                {canManage && member.user_id !== currentUserId && member.role !== "owner" && (
                  <button
                    onClick={() => removeMember(member.user_id)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 text-red-400 hover:bg-red-400/10 transition-all"
                    title="Remove member"
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-gray-800/50 space-y-1">
          {canManage && (
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800 text-gray-400 text-sm transition-colors">
              <Settings size={16} />
              Group settings
            </button>
          )}
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800 text-red-400 text-sm transition-colors">
            <LogOut size={16} />
            Leave group
          </button>
        </div>
      </div>
    </div>
  );
}
