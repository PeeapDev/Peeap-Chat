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
import * as e2ee from "@/lib/e2eeManager";
import { isEncryptableConversationType, type E2EEStatus } from "@/lib/e2eeManager";

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

  // E2EE
  e2eeStatus: E2EEStatus;
  setupE2EE: (password: string) => Promise<void>;
  restoreE2EE: (password: string) => Promise<void>;
  skipE2EE: () => void;

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

  // E2EE state
  const [e2eeStatus, setE2eeStatus] = useState<E2EEStatus>("unknown");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  // Always-current mirror of currentUserId so the long-lived realtime handler
  // doesn't compare against a stale closure value (self-messages would ping).
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  // Tracks which conversation the user is actively viewing so late-arriving
  // fetches for a previously-selected conversation can be dropped.
  const activeReqRef = useRef<string | null>(null);

  // ── 1. Restore auth from IndexedDB or URL params ───────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    async function restoreAuth() {
      try {
        // Check URL params first (for backward compat links)
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get("token") || "";
        const urlUserId = params.get("user_id") || "";

        if (urlToken) {
          setToken(urlToken);
          setCurrentUserId(urlUserId);
          chatAPI.setToken(urlToken);
          // Remove credentials from the address bar before touching storage.
          window.history.replaceState({}, "", window.location.pathname);
          await saveAuth(urlToken, urlUserId, null);
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
      } catch (err) {
        // IndexedDB may be blocked or unavailable on some mobile browsers.
        // Authentication can still continue through QR/SSO; never leave the
        // entire application hidden behind a permanent loading screen.
        console.warn("Chat auth storage unavailable:", err);
      } finally {
        setAuthLoaded(true);
      }
    }

    void restoreAuth();
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
    e2ee.reset();
    setE2eeStatus("unknown");
    await clearAuth();
  }, []);

  // ── 3b. Request notification permission after auth ─────────
  useEffect(() => {
    if (token && authLoaded) {
      requestNotificationPermission();
    }
  }, [token, authLoaded]);

  // ── 3c. Initialise E2EE identity after auth ────────────────
  useEffect(() => {
    if (!token || !currentUserId || !authLoaded) return;
    let cancelled = false;
    e2ee.setToken(token);
    e2ee
      .init(currentUserId, token)
      .then((status) => {
        if (!cancelled) setE2eeStatus(status);
      })
      .catch(() => {
        if (!cancelled) setE2eeStatus("off");
      });
    return () => {
      cancelled = true;
    };
  }, [token, currentUserId, authLoaded]);

  // Decrypt any encrypted messages in a batch (no-op if E2EE isn't ready).
  const decryptMessages = useCallback(
    async (msgs: Message[]): Promise<Message[]> => {
      if (!e2ee.isReady()) return msgs;
      return Promise.all(
        msgs.map(async (m) => {
          if (m.is_encrypted && m.encrypted_content && m.encryption_metadata) {
            try {
              const text = await e2ee.decrypt(
                m.encrypted_content,
                m.encryption_metadata as unknown as Parameters<typeof e2ee.decrypt>[1]
              );
              return { ...m, content: text };
            } catch {
              return { ...m, content: "🔒 Unable to decrypt this message" };
            }
          }
          return m;
        })
      );
    },
    []
  );

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
          const rawMsg = payload.new as Message;

          const apply = (newMsg: Message) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              const updated = [...prev, newMsg];
              saveMessages([newMsg]);
              return updated;
            });
            updateConversationLastMessage(activeConversationId, newMsg);

            // Notify if message is from someone else
            if (newMsg.sender_id !== currentUserIdRef.current) {
              const senderName = newMsg.sender?.display_name || "Someone";
              const body = newMsg.content || `[${newMsg.message_type}]`;
              showNotification(senderName, body, { tag: newMsg.conversation_id });
              playMessageSound();
            }
          };

          // Decrypt E2EE messages before rendering/caching/notifying.
          if (
            rawMsg.is_encrypted &&
            rawMsg.encrypted_content &&
            rawMsg.encryption_metadata &&
            e2ee.isReady()
          ) {
            e2ee
              .decrypt(
                rawMsg.encrypted_content,
                rawMsg.encryption_metadata as unknown as Parameters<typeof e2ee.decrypt>[1]
              )
              .then((text) => apply({ ...rawMsg, content: text }))
              .catch(() => apply({ ...rawMsg, content: "🔒 Unable to decrypt this message" }));
          } else {
            apply(rawMsg);
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
      activeReqRef.current = id;
      setMessages([]);
      setHasMoreMessages(false);

      if (window.innerWidth < 768) setShowSidebar(false);

      // Load from IndexedDB instantly
      const cachedRaw = await loadMessagesFromDB(id, 50);
      // Drop if the user has since switched to another conversation.
      if (activeReqRef.current !== id) return;
      const cached = await decryptMessages(cachedRaw);
      if (activeReqRef.current !== id) return;
      if (cached.length > 0) {
        setMessages(cached);
      } else {
        setLoadingMessages(true);
      }

      // Then fetch fresh from API
      try {
        const data = await chatAPI.getMessages(id, { limit: 50 });
        // Stale response for a conversation no longer in view — ignore it so we
        // don't render conversation A's messages under conversation B.
        if (activeReqRef.current !== id) return;
        const fresh = await decryptMessages(data.messages || []);
        if (activeReqRef.current !== id) return;
        setMessages(fresh);
        setHasMoreMessages(fresh.length >= 50);
        // Save decrypted copies to IndexedDB for instant offline reads.
        await saveMessages(fresh);
        // Mark as read
        chatAPI.markAsRead(id).catch(() => {});
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c))
        );
      } catch (err: unknown) {
        if (activeReqRef.current === id && cached.length === 0) {
          setError(err instanceof Error ? err.message : "Failed to load messages");
        }
      } finally {
        if (activeReqRef.current === id) setLoadingMessages(false);
      }
    },
    []
  );

  const sendMessage = useCallback(
    async (content: string, type: string = "text", extra?: Record<string, unknown>) => {
      if (!activeConversationId) return;
      try {
        const conv = conversationsRef.current.find(
          (c) => c.id === activeConversationId
        );

        // Encrypt text for direct/group chats when E2EE is ready and every
        // member has published a key. Otherwise fall back to a labelled
        // plaintext send so messaging keeps working during rollout.
        if (
          content &&
          isEncryptableConversationType(conv?.type) &&
          e2ee.isReady()
        ) {
          const memberIds = (conv?.members || []).map((m) => m.user_id);
          const encrypted = await e2ee.encrypt(content, memberIds);
          if (encrypted) {
            await chatAPI.sendMessage(activeConversationId, {
              message_type: type as Message["message_type"],
              is_encrypted: true,
              encrypted_content: encrypted.encrypted_content,
              encryption_metadata: encrypted.encryption_metadata as unknown as Record<string, unknown>,
              ...extra,
            });
            return;
          }
        }

        const encryptable = isEncryptableConversationType(conv?.type);
        await chatAPI.sendMessage(activeConversationId, {
          content,
          message_type: type as Message["message_type"],
          ...extra,
          // Mark that an encryptable chat was sent in the clear (recipient
          // hadn't enabled E2EE yet) so the UI can surface a "not encrypted" hint.
          ...(encryptable
            ? { metadata: { ...(extra?.metadata as object | undefined), e2ee_fallback: true } }
            : {}),
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
      const older = await decryptMessages(data.messages || []);
      setMessages((prev) => [...older, ...prev]);
      setHasMoreMessages(older.length >= 50);
      // Cache decrypted older messages too
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

  // ── E2EE actions (driven by the setup/unlock modal) ────────
  const setupE2EE = useCallback(async (password: string) => {
    await e2ee.setup(password);
    setE2eeStatus(e2ee.getStatus());
  }, []);

  const restoreE2EE = useCallback(async (password: string) => {
    await e2ee.restore(password);
    setE2eeStatus(e2ee.getStatus());
  }, []);

  const skipE2EE = useCallback(() => {
    e2ee.skip();
    setE2eeStatus("off");
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
        e2eeStatus,
        setupE2EE,
        restoreE2EE,
        skipE2EE,
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
