"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { chatAPI } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  saveAuth,
  loadAuth,
  clearAuth,
  saveConversations,
  loadConversations as loadConversationsFromDB,
  saveMessages,
  loadMessages as loadMessagesFromDB,
} from "@/lib/db";
import type { Conversation, Message, ChatUser } from "@/lib/types";
import {
  requestNotificationPermission,
  showNotification,
  updateTabBadge,
  playMessageSound,
} from "@/lib/notifications";

interface ChatState {
  // Auth
  token: string;
  currentUserId: string;
  currentUser: ChatUser | null;
  isAuthenticated: boolean;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  loadingConversations: boolean;

  // Messages
  messages: Message[];
  loadingMessages: boolean;
  hasMoreMessages: boolean;

  // UI
  showSidebar: boolean;
  error: string | null;

  // Actions
  selectConversation: (id: string) => void;
  sendMessage: (content: string, type?: string, extra?: Record<string, unknown>) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  createConversation: (type: string, memberIds: string[], name?: string) => Promise<Conversation>;
  refreshConversations: () => Promise<void>;
  setShowSidebar: (show: boolean) => void;
  deleteMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  clearError: () => void;
  handleQRLogin: (token: string, userId: string) => void;
  logout: () => void;
}

const ChatContext = createContext<ChatState | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used inside ChatProvider");
  return ctx;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  // Auth state
  const [token, setToken] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUser, setCurrentUser] = useState<ChatUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);

  // UI state
  const [showSidebar, setShowSidebar] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  // ── 1. Restore auth from IndexedDB or URL params ───────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    async function restoreAuth() {
      // Check URL params first (for backward compat links)
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token") || "";
      const urlUserId = params.get("user_id") || "";

      if (urlToken) {
        setToken(urlToken);
        setCurrentUserId(urlUserId);
        chatAPI.setToken(urlToken);
        // Persist to IndexedDB
        await saveAuth(urlToken, urlUserId, null);
        // Clean URL
        window.history.replaceState({}, "", window.location.pathname);
        setAuthLoaded(true);
        return;
      }

      // Try to restore from IndexedDB
      const saved = await loadAuth();
      if (saved) {
        setToken(saved.token);
        setCurrentUserId(saved.userId);
        setCurrentUser(saved.user);
        chatAPI.setToken(saved.token);
      }
      setAuthLoaded(true);
    }

    restoreAuth();
  }, []);

  // ── 2. QR Login handler ────────────────────────────────────
  const handleQRLogin = useCallback(async (newToken: string, userId: string) => {
    setToken(newToken);
    setCurrentUserId(userId);
    chatAPI.setToken(newToken);
    await saveAuth(newToken, userId, null);
  }, []);

  // ── 3. Logout ──────────────────────────────────────────────
  const logout = useCallback(async () => {
    setToken("");
    setCurrentUserId("");
    setCurrentUser(null);
    setConversations([]);
    setMessages([]);
    setActiveConversationId(null);
    chatAPI.setToken("");
    await clearAuth();
  }, []);

  // ── 3b. Request notification permission after auth ─────────
  useEffect(() => {
    if (token && authLoaded) {
      requestNotificationPermission();
    }
  }, [token, authLoaded]);

  // ── 4. Load conversations: IndexedDB first, then API ──────
  useEffect(() => {
    if (!token || !authLoaded) return;

    async function loadFromCacheAndSync() {
      // Load from IndexedDB immediately (no spinner)
      const cached = await loadConversationsFromDB();
      if (cached.length > 0) {
        setConversations(cached);
        setLoadingConversations(false);
      }

      // Then sync from API in background
      try {
        const data = await chatAPI.getConversations({ limit: 50 });
        const fresh = data.conversations || [];
        setConversations(fresh);
        // Save to IndexedDB for next load
        await saveConversations(fresh);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // If token expired (401), clear session and show QR login
        if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
          await clearAuth();
          setToken("");
          setCurrentUserId("");
          setCurrentUser(null);
          setConversations([]);
        } else if (cached.length === 0) {
          setError(msg);
        }
      } finally {
        setLoadingConversations(false);
      }
    }

    loadFromCacheAndSync();
  }, [token, authLoaded]);

  // ── 5. Realtime subscription for active conversation ───────
  useEffect(() => {
    if (!activeConversationId) return;

    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
    }

    const channel = supabase
      .channel(`chat:${activeConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            const updated = [...prev, newMsg];
            saveMessages([newMsg]);
            return updated;
          });
          updateConversationLastMessage(activeConversationId, newMsg);

          // Notify if message is from someone else
          if (newMsg.sender_id !== currentUserId) {
            const senderName = newMsg.sender?.display_name || "Someone";
            const body = newMsg.content || `[${newMsg.message_type}]`;
            showNotification(senderName, body, { tag: newMsg.conversation_id });
            playMessageSound();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
    };
  }, [activeConversationId]);

  // ── 6. Resolve current user profile from conversations ─────
  useEffect(() => {
    if (currentUser || !currentUserId || conversations.length === 0) return;
    for (const conv of conversations) {
      const me = conv.members?.find((m) => m.user_id === currentUserId);
      if (me?.profile) {
        setCurrentUser(me.profile);
        // Persist user profile to IndexedDB
        saveAuth(token, currentUserId, me.profile);
        break;
      }
    }
  }, [conversations, currentUserId, currentUser, token]);

  // ── 7. Update tab badge when unread counts change ──────────
  useEffect(() => {
    const total = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    updateTabBadge(total);
  }, [conversations]);

  // ── Helpers ────────────────────────────────────────────────

  function updateConversationLastMessage(convId: string, msg: Message) {
    setConversations((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          last_message_content:
            msg.message_type === "text"
              ? msg.content?.substring(0, 200) ?? null
              : `[${msg.message_type}]`,
          last_message_sender_id: msg.sender_id,
          last_message_at: msg.created_at,
          last_message_type: msg.message_type,
        };
      });
      // Persist update
      saveConversations(updated);
      return updated;
    });
  }

  // ── Select conversation: IndexedDB first, then API ─────────
  const selectConversation = useCallback(
    async (id: string) => {
      setActiveConversationId(id);
      setMessages([]);
      setHasMoreMessages(false);

      if (window.innerWidth < 768) setShowSidebar(false);

      // Load from IndexedDB instantly
      const cached = await loadMessagesFromDB(id, 50);
      if (cached.length > 0) {
        setMessages(cached);
      } else {
        setLoadingMessages(true);
      }

      // Then fetch fresh from API
      try {
        const data = await chatAPI.getMessages(id, { limit: 50 });
        const fresh = data.messages || [];
        setMessages(fresh);
        setHasMoreMessages(fresh.length >= 50);
        // Save to IndexedDB
        await saveMessages(fresh);
        // Mark as read
        chatAPI.markAsRead(id).catch(() => {});
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c))
        );
      } catch (err: unknown) {
        if (cached.length === 0) {
          setError(err instanceof Error ? err.message : "Failed to load messages");
        }
      } finally {
        setLoadingMessages(false);
      }
    },
    []
  );

  const sendMessage = useCallback(
    async (content: string, type: string = "text", extra?: Record<string, unknown>) => {
      if (!activeConversationId) return;
      try {
        await chatAPI.sendMessage(activeConversationId, {
          content,
          message_type: type as Message["message_type"],
          ...extra,
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send message");
      }
    },
    [activeConversationId]
  );

  const loadMoreMessages = useCallback(async () => {
    if (!activeConversationId || !hasMoreMessages || loadingMessages) return;
    const oldest = messages[0];
    if (!oldest) return;

    try {
      setLoadingMessages(true);
      const data = await chatAPI.getMessages(activeConversationId, {
        limit: 50,
        before: oldest.created_at,
      });
      const older = data.messages || [];
      setMessages((prev) => [...older, ...prev]);
      setHasMoreMessages(older.length >= 50);
      // Cache older messages too
      await saveMessages(older);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load older messages");
    } finally {
      setLoadingMessages(false);
    }
  }, [activeConversationId, hasMoreMessages, loadingMessages, messages]);

  const createConversation = useCallback(
    async (type: string, memberIds: string[], name?: string): Promise<Conversation> => {
      const data = await chatAPI.createConversation({
        type,
        member_ids: memberIds,
        name,
      });
      setConversations((prev) => {
        const updated = [data.conversation, ...prev];
        saveConversations(updated);
        return updated;
      });
      return data.conversation;
    },
    []
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      try {
        await chatAPI.deleteMessage(messageId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, is_deleted: true, content: null }
              : m
          )
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete message");
      }
    },
    []
  );

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      try {
        await chatAPI.editMessage(messageId, content);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, content, is_edited: true, edited_at: new Date().toISOString() }
              : m
          )
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to edit message");
      }
    },
    []
  );

  const refreshConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const data = await chatAPI.getConversations({ limit: 50 });
      const fresh = data.conversations || [];
      setConversations(fresh);
      await saveConversations(fresh);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? null;

  const isAuthenticated = authLoaded && !!token && !!currentUserId;

  // Don't render children until auth is loaded from IndexedDB
  if (!authLoaded) return null;

  return (
    <ChatContext.Provider
      value={{
        token,
        currentUserId,
        currentUser,
        isAuthenticated,
        conversations,
        activeConversationId,
        activeConversation,
        loadingConversations,
        messages,
        loadingMessages,
        hasMoreMessages,
        showSidebar,
        error,
        selectConversation,
        sendMessage,
        loadMoreMessages,
        createConversation,
        refreshConversations,
        setShowSidebar,
        deleteMessage,
        editMessage,
        clearError: () => setError(null),
        handleQRLogin,
        logout,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
