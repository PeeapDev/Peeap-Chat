"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Search,
  Plus,
  MessageSquare,
  Users,
  Headphones,
  Pin,
  PinOff,
  Archive,
  Loader2,
  UserPlus,
  LogOut,
  Contact2,
  Star,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useChatContext } from "@/components/ChatProvider";
import { chatAPI } from "@/lib/api";
import Avatar from "@/components/ui/Avatar";
import FriendRequestsList from "@/components/chat/FriendRequestsList";
import AddFriendModal from "@/components/modals/AddFriendModal";
import {
  getConversationName,
  getConversationAvatar,
  getLastMessagePreview,
  formatConversationTime,
} from "@/lib/utils";
import type { Conversation, ChatUser, FriendRequest, Contact } from "@/lib/types";

// ── Tab types ──
type SidebarTab = "chats" | "contacts";

const TYPE_FILTERS: Array<{
  label: string;
  value: string | null;
  icon: React.ReactNode;
}> = [
  { label: "All", value: null, icon: <MessageSquare size={14} /> },
  { label: "Direct", value: "direct", icon: <MessageSquare size={14} /> },
  { label: "Groups", value: "group", icon: <Users size={14} /> },
  { label: "Support", value: "support", icon: <Headphones size={14} /> },
];

interface SidebarProps {
  onNewChat: () => void;
}

export default function Sidebar({ onNewChat }: SidebarProps) {
  const {
    conversations,
    activeConversationId,
    selectConversation,
    createConversation,
    currentUserId,
    currentUser,
    loadingConversations,
    token,
    logout,
  } = useChatContext();

  const [activeTab, setActiveTab] = useState<SidebarTab>("chats");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [userResults, setUserResults] = useState<ChatUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Friends state
  const [friends, setFriends] = useState<Contact[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [showRequests, setShowRequests] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    convId: string;
    x: number;
    y: number;
  } | null>(null);

  // Friend context menu
  const [friendCtx, setFriendCtx] = useState<{
    userId: string;
    x: number;
    y: number;
  } | null>(null);

  // Load friends & requests when contacts tab is active
  const loadFriendsData = useCallback(async () => {
    if (!token) return;
    setLoadingFriends(true);
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        chatAPI.getFriends(),
        chatAPI.getFriendRequests(),
      ]);
      setFriends(friendsRes.friends || []);
      setIncomingRequests(requestsRes.incoming || []);
      setOutgoingRequests(requestsRes.outgoing || []);
      setRequestCount(requestsRes.incoming_count || 0);
    } catch {
      // silent
    } finally {
      setLoadingFriends(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === "contacts") {
      loadFriendsData();
    }
  }, [activeTab, loadFriendsData]);

  // Also poll request count when on chats tab (for badge)
  useEffect(() => {
    if (!token) return;
    chatAPI.getFriendRequests().then((res) => {
      setRequestCount(res.incoming_count || 0);
    }).catch(() => {});

    const interval = setInterval(() => {
      chatAPI.getFriendRequests().then((res) => {
        setRequestCount(res.incoming_count || 0);
      }).catch(() => {});
    }, 30000); // Poll every 30s

    return () => clearInterval(interval);
  }, [token]);

  // Search Peeap users when typing 2+ chars (chats tab)
  useEffect(() => {
    if (activeTab !== "chats" || search.trim().length < 2) {
      setUserResults([]);
      return;
    }
    if (!token) return;

    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearchingUsers(true);
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(search)}&limit=10`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        setUserResults(
          (data.users || []).filter(
            (u: ChatUser) => u.id !== currentUserId
          )
        );
      } catch {
        setUserResults([]);
      } finally {
        setSearchingUsers(false);
      }
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [search, currentUserId, token, activeTab]);

  async function handleStartChat(user: ChatUser) {
    try {
      const conv = await createConversation("direct", [user.id]);
      selectConversation(conv.id);
      setSearch("");
      setUserResults([]);
    } catch {
      // silent
    }
  }

  async function handleStartChatWithFriend(friendUserId: string) {
    try {
      const conv = await createConversation("direct", [friendUserId]);
      selectConversation(conv.id);
      setActiveTab("chats");
    } catch {
      // silent
    }
  }

  async function handleRemoveFriend(userId: string) {
    try {
      await chatAPI.removeFriend(userId);
      setFriends((prev) => prev.filter((f) => f.contact_user_id !== userId));
    } catch {
      // silent
    }
    setFriendCtx(null);
  }

  const filtered = useMemo(() => {
    let list = conversations;

    if (typeFilter) {
      list = list.filter((c) => c.type === typeFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => {
        const name = getConversationName(c, currentUserId).toLowerCase();
        const lastMsg = (c.last_message_content || "").toLowerCase();
        return name.includes(q) || lastMsg.includes(q);
      });
    }

    return [...list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const ta = a.last_message_at || a.created_at;
      const tb = b.last_message_at || b.created_at;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
  }, [conversations, search, typeFilter, currentUserId]);

  // Filter friends by search
  const filteredFriends = useMemo(() => {
    if (!friendSearch.trim()) return friends;
    const q = friendSearch.toLowerCase();
    return friends.filter((f) => {
      const name = (f.profile?.display_name || "").toLowerCase();
      const phone = (f.profile?.phone || "").toLowerCase();
      const email = (f.profile?.email || "").toLowerCase();
      return name.includes(q) || phone.includes(q) || email.includes(q);
    });
  }, [friends, friendSearch]);

  // Group friends: favorites first, then alphabetical
  const groupedFriends = useMemo(() => {
    const favs = filteredFriends.filter((f) => f.is_favorite);
    const rest = filteredFriends.filter((f) => !f.is_favorite);
    const sorted = (list: Contact[]) =>
      [...list].sort((a, b) =>
        (a.profile?.display_name || "").localeCompare(b.profile?.display_name || "")
      );
    return { favorites: sorted(favs), all: sorted(rest) };
  }, [filteredFriends]);

  const totalUnread = conversations.reduce(
    (s, c) => s + (c.unread_count || 0),
    0
  );

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-800/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-white tracking-tight">
              {activeTab === "chats" ? "Messages" : "Contacts"}
            </h1>
            {activeTab === "chats" && totalUnread > 0 && (
              <span className="bg-indigo-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </div>
          {activeTab === "chats" ? (
            <button
              onClick={onNewChat}
              className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              title="New conversation"
            >
              <Plus size={18} />
            </button>
          ) : (
            <button
              onClick={() => setAddFriendOpen(true)}
              className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              title="Add friend"
            >
              <UserPlus size={18} />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="text"
            value={activeTab === "chats" ? search : friendSearch}
            onChange={(e) =>
              activeTab === "chats"
                ? setSearch(e.target.value)
                : setFriendSearch(e.target.value)
            }
            placeholder={
              activeTab === "chats"
                ? "Search conversations..."
                : "Search friends..."
            }
            className="w-full bg-gray-800 border border-gray-700/50 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
        </div>

        {/* Tab switcher (Chats | Contacts) */}
        <div className="flex gap-1 mt-3">
          <button
            onClick={() => setActiveTab("chats")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "chats"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-gray-300"
            }`}
          >
            <MessageSquare size={14} />
            Chats
            {totalUnread > 0 && activeTab !== "chats" && (
              <span className="bg-indigo-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("contacts")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "contacts"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-gray-300"
            }`}
          >
            <Contact2 size={14} />
            Contacts
            {requestCount > 0 && (
              <span className="bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                {requestCount}
              </span>
            )}
          </button>
        </div>

        {/* Type filters (chats tab only) */}
        {activeTab === "chats" && (
          <div className="flex gap-1 mt-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.label}
                onClick={() => setTypeFilter(f.value)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  typeFilter === f.value
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-300"
                }`}
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── CHATS TAB CONTENT ── */}
      {activeTab === "chats" && (
        <>
          {/* User search results */}
          {search.trim().length >= 2 &&
            (userResults.length > 0 || searchingUsers) && (
              <div className="border-b border-gray-800">
                <div className="px-4 py-2 flex items-center gap-2">
                  <UserPlus size={12} className="text-gray-500" />
                  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Peeap Users
                  </span>
                  {searchingUsers && (
                    <Loader2
                      size={12}
                      className="animate-spin text-gray-500"
                    />
                  )}
                </div>
                {userResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleStartChat(user)}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-gray-800/40 transition-colors"
                  >
                    <Avatar
                      src={user.avatar_url}
                      name={user.display_name}
                      id={user.id}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        {user.display_name}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {user.phone || user.email || user.account_type}
                      </p>
                    </div>
                    <span className="text-[10px] text-indigo-400 shrink-0">
                      Chat
                    </span>
                  </button>
                ))}
              </div>
            )}

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {loadingConversations ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-indigo-500 rounded-full" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageSquare
                  size={32}
                  className="mx-auto text-gray-700 mb-2"
                />
                <p className="text-gray-500 text-sm">
                  {search
                    ? "No conversations found"
                    : "No conversations yet"}
                </p>
                {!search && (
                  <button
                    onClick={onNewChat}
                    className="mt-2 text-indigo-400 text-sm hover:underline"
                  >
                    Start a new chat
                  </button>
                )}
              </div>
            ) : (
              filtered.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isActive={activeConversationId === conv.id}
                  currentUserId={currentUserId}
                  onSelect={() => selectConversation(conv.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({
                      convId: conv.id,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* ── CONTACTS TAB CONTENT ── */}
      {activeTab === "contacts" && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Friend Requests button */}
          <button
            onClick={() => setShowRequests(!showRequests)}
            className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-800/40 transition-colors border-b border-gray-800/30"
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <UserPlus size={18} className="text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Friend Requests</p>
              <p className="text-[11px] text-gray-500">
                {requestCount > 0
                  ? `${requestCount} pending`
                  : "No pending requests"}
              </p>
            </div>
            {requestCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {requestCount}
              </span>
            )}
          </button>

          {/* Expandable requests list */}
          {showRequests && (
            <div className="border-b border-gray-800/50 bg-gray-800/20">
              <FriendRequestsList
                incoming={incomingRequests}
                outgoing={outgoingRequests}
                onResponded={loadFriendsData}
              />
            </div>
          )}

          {/* Loading state */}
          {loadingFriends ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-indigo-500 rounded-full" />
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Contact2 size={32} className="mx-auto text-gray-700 mb-2" />
              <p className="text-gray-500 text-sm">
                {friendSearch ? "No friends found" : "No friends yet"}
              </p>
              {!friendSearch && (
                <button
                  onClick={() => setAddFriendOpen(true)}
                  className="mt-2 text-indigo-400 text-sm hover:underline"
                >
                  Add your first friend
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Favorites section */}
              {groupedFriends.favorites.length > 0 && (
                <>
                  <div className="px-4 py-2 flex items-center gap-2">
                    <Star size={12} className="text-amber-400" />
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                      Favorites
                    </span>
                  </div>
                  {groupedFriends.favorites.map((friend) => (
                    <FriendItem
                      key={friend.id}
                      friend={friend}
                      onChat={() =>
                        handleStartChatWithFriend(friend.contact_user_id)
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFriendCtx({
                          userId: friend.contact_user_id,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                    />
                  ))}
                </>
              )}

              {/* All friends */}
              {groupedFriends.all.length > 0 && (
                <>
                  <div className="px-4 py-2 flex items-center gap-2">
                    <Contact2 size={12} className="text-gray-500" />
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                      Friends ({groupedFriends.all.length})
                    </span>
                  </div>
                  {groupedFriends.all.map((friend) => (
                    <FriendItem
                      key={friend.id}
                      friend={friend}
                      onChat={() =>
                        handleStartChatWithFriend(friend.contact_user_id)
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFriendCtx({
                          userId: friend.contact_user_id,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* User footer */}
      {currentUser && (
        <div className="p-3 border-t border-gray-800/80 flex items-center gap-3">
          <Avatar
            src={currentUser.avatar_url}
            name={currentUser.display_name}
            id={currentUserId}
            size="sm"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {currentUser.display_name}
            </p>
            <p className="text-[10px] text-gray-500 truncate">
              {currentUser.email || currentUser.phone || "Online"}
            </p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-red-400 transition-colors"
            title="Log out"
          >
            <LogOut size={16} />
          </button>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <ConversationContextMenu
          convId={ctxMenu.convId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          conversations={conversations}
          token={token}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Friend context menu */}
      {friendCtx && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFriendCtx(null)} />
          <div
            style={{
              position: "fixed",
              left: Math.min(friendCtx.x, window.innerWidth - 160),
              top: Math.min(friendCtx.y, window.innerHeight - 100),
              zIndex: 50,
            }}
            className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[140px] animate-fade-in"
          >
            <button
              onClick={() => {
                handleStartChatWithFriend(friendCtx.userId);
                setFriendCtx(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700/50"
            >
              <MessageSquare size={14} />
              Message
            </button>
            <button
              onClick={() => handleRemoveFriend(friendCtx.userId)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-gray-700/50"
            >
              <Trash2 size={14} />
              Remove Friend
            </button>
          </div>
        </>
      )}

      {/* Add Friend Modal */}
      <AddFriendModal
        open={addFriendOpen}
        onClose={() => setAddFriendOpen(false)}
        onRequestSent={loadFriendsData}
      />
    </div>
  );
}

// ── Friend Item ─────────────────────────────────────────────

function FriendItem({
  friend,
  onChat,
  onContextMenu,
}: {
  friend: Contact;
  onChat: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const profile = friend.profile;
  const name = friend.nickname || profile?.display_name || "User";

  return (
    <button
      onClick={onChat}
      onContextMenu={onContextMenu}
      className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-gray-800/40 transition-colors border-b border-gray-800/20"
    >
      <Avatar
        src={profile?.avatar_url || null}
        name={name}
        id={friend.contact_user_id}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{name}</p>
        <p className="text-[11px] text-gray-500 truncate">
          {profile?.phone || profile?.email || ""}
        </p>
      </div>
      {friend.is_favorite && (
        <Star size={12} className="text-amber-400 shrink-0" fill="currentColor" />
      )}
    </button>
  );
}

// ── Conversation Item ────────────────────────────────────────

function ConversationItem({
  conversation: conv,
  isActive,
  currentUserId,
  onSelect,
  onContextMenu,
}: {
  conversation: Conversation;
  isActive: boolean;
  currentUserId: string;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const name = getConversationName(conv, currentUserId);
  const avatar = getConversationAvatar(conv, currentUserId);
  const preview = getLastMessagePreview(conv);
  const time = formatConversationTime(conv.last_message_at);
  const isGroup =
    conv.type === "group" ||
    conv.type === "school_class" ||
    conv.type === "business_channel";

  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b border-gray-800/30 ${
        isActive ? "bg-gray-800/80" : "hover:bg-gray-800/40"
      }`}
    >
      <Avatar src={avatar} name={name} id={conv.id} size="md" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium text-white truncate">
              {name}
            </span>
            {isGroup && (
              <Users size={12} className="text-gray-500 shrink-0" />
            )}
            {conv.pinned && (
              <Pin size={11} className="text-indigo-400 shrink-0" />
            )}
          </div>
          <span className="text-[11px] text-gray-500 shrink-0">{time}</span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs text-gray-400 truncate">
            {conv.last_message_type === "payment_request" && (
              <span className="text-emerald-400">&#x1F4B0; </span>
            )}
            {preview || "No messages yet"}
          </p>
          {conv.unread_count > 0 && (
            <span className="bg-indigo-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
              {conv.unread_count > 99 ? "99+" : conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Context Menu ─────────────────────────────────────────────

function ConversationContextMenu({
  convId,
  x,
  y,
  conversations,
  token,
  onClose,
}: {
  convId: string;
  x: number;
  y: number;
  conversations: Conversation[];
  token: string;
  onClose: () => void;
}) {
  const conv = conversations.find((c) => c.id === convId);
  if (!conv) return null;

  const isPinned = conv.pinned;

  async function handleAction(action: string) {
    onClose();
    try {
      if (action === "pin" || action === "unpin") {
        await fetch(`/api/conversations/${convId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            metadata: { ...(conv?.metadata || {}), pinned: action === "pin" },
          }),
        });
      } else if (action === "archive") {
        await fetch(`/api/conversations/${convId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // silent
    }
  }

  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, window.innerHeight - 160),
    zIndex: 50,
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={menuStyle}
        className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-[160px] animate-fade-in"
      >
        <button
          onClick={() => handleAction(isPinned ? "unpin" : "pin")}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700/50"
        >
          {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          {isPinned ? "Unpin" : "Pin conversation"}
        </button>
        <button
          onClick={() => handleAction("archive")}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-gray-700/50"
        >
          <Archive size={14} />
          Archive
        </button>
      </div>
    </>
  );
}
