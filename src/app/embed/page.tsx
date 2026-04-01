"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { formatMessageTime, isSameDay, formatDateSeparator } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { Send, Loader2, MessageCircle, ArrowDown } from "lucide-react";

// ============================================================
// Embeddable Public Chat
// URL: /embed?user=PEEAP_USER_ID
// Guest enters name + email → direct conversation with the Peeap user
// ============================================================

interface GuestUser {
  id: string;
  name: string;
  email: string;
}

interface TargetProfile {
  display_name: string;
  avatar_url: string | null;
}

function EmbedChatInner() {
  const searchParams = useSearchParams();
  const targetUserId = searchParams.get("user") || "";
  const theme = searchParams.get("theme") || "dark";
  const title = searchParams.get("title") || "";

  // Auth state
  const [token, setToken] = useState("");
  const [user, setUser] = useState<GuestUser | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [targetProfile, setTargetProfile] = useState<TargetProfile | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const prevMsgCount = useRef(0);

  const isDark = theme === "dark";
  const headerTitle = title || targetProfile?.display_name || "Chat";

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 100) + "px";
    }
  }, [text]);

  // Auto-scroll on new messages
  useEffect(() => {
    const isNew = messages.length > prevMsgCount.current;
    prevMsgCount.current = messages.length;
    if (!isNew) return;

    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Initial scroll to bottom when messages first load
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      bottomRef.current?.scrollIntoView();
    }
  }, [loadingMessages]);

  // Subscribe to realtime messages
  useEffect(() => {
    if (!conversationId) return;

    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const ch = supabase
      .channel(`embed:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    channelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [conversationId]);

  // Load messages when conversation is set
  const loadMessages = useCallback(async () => {
    if (!conversationId || !token) return;
    setLoadingMessages(true);
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/messages?limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingMessages(false);
    }
  }, [conversationId, token]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Guest login
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          user_id: targetUserId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || "Login failed");
        return;
      }

      setToken(data.token);
      setUser({ id: data.user_id, name: name.trim(), email: email.trim() });
      setConversationId(data.conversation_id);
      if (data.target_profile) {
        setTargetProfile(data.target_profile);
      }
    } catch {
      setLoginError("Connection failed. Please try again.");
    } finally {
      setLoggingIn(false);
    }
  }

  // Send message
  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || !conversationId || !token || sending) return;

    setSending(true);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: trimmed, message_type: "text" }),
      });
    } catch {
      // silently fail
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    setShowScrollDown(!nearBottom && messages.length > 10);
  }

  function getInitials(n: string) {
    return n
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function getColor(id: string) {
    const colors = [
      "bg-indigo-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600",
      "bg-cyan-600", "bg-violet-600", "bg-orange-600", "bg-teal-600",
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  // ── No user ID provided ──
  if (!targetUserId) {
    return (
      <div
        className={`h-screen flex items-center justify-center p-6 ${
          isDark ? "bg-gray-950 text-white" : "bg-white text-gray-900"
        }`}
      >
        <div className="text-center">
          <MessageCircle size={40} className="text-gray-600 mx-auto mb-3" />
          <p className={isDark ? "text-gray-400" : "text-gray-500"}>
            Invalid chat link. Missing user ID.
          </p>
        </div>
      </div>
    );
  }

  // ── Login Screen ──
  if (!token || !user) {
    return (
      <div
        className={`h-screen flex flex-col items-center justify-center p-6 ${
          isDark ? "bg-gray-950 text-white" : "bg-white text-gray-900"
        }`}
      >
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                isDark ? "bg-indigo-600/20" : "bg-indigo-50"
              }`}
            >
              <MessageCircle size={28} className="text-indigo-500" />
            </div>
            <h1 className="text-xl font-semibold">
              {title || "Start a conversation"}
            </h1>
            <p
              className={`text-sm mt-1 ${
                isDark ? "text-gray-400" : "text-gray-500"
              }`}
            >
              Enter your name and email to chat
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${
                  isDark ? "text-gray-300" : "text-gray-700"
                }`}
              >
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                autoFocus
                className={`w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
                  isDark
                    ? "bg-gray-800 border border-gray-700 text-white placeholder-gray-500"
                    : "bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            </div>

            <div>
              <label
                className={`block text-sm font-medium mb-1.5 ${
                  isDark ? "text-gray-300" : "text-gray-700"
                }`}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className={`w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
                  isDark
                    ? "bg-gray-800 border border-gray-700 text-white placeholder-gray-500"
                    : "bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            </div>

            {loginError && (
              <p className="text-red-400 text-sm">{loginError}</p>
            )}

            <button
              type="submit"
              disabled={loggingIn || !name.trim() || !email.trim()}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loggingIn ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Connecting...
                </>
              ) : (
                "Start Chat"
              )}
            </button>
          </form>

          <p
            className={`text-center text-[11px] mt-6 ${
              isDark ? "text-gray-600" : "text-gray-400"
            }`}
          >
            Powered by{" "}
            <a
              href="https://peeap.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline"
            >
              Peeap
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ── Chat Screen ──
  return (
    <div
      className={`h-screen flex flex-col ${
        isDark ? "bg-gray-950 text-white" : "bg-white text-gray-900"
      }`}
    >
      {/* Header */}
      <div
        className={`px-4 py-3 border-b flex items-center gap-3 shrink-0 ${
          isDark ? "border-gray-800 bg-gray-900/80" : "border-gray-200 bg-gray-50"
        }`}
      >
        {targetProfile?.avatar_url ? (
          <img
            src={targetProfile.avatar_url}
            alt={headerTitle}
            className="w-9 h-9 rounded-full object-cover"
          />
        ) : (
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-medium ${getColor(
              targetUserId
            )}`}
          >
            {getInitials(headerTitle)}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{headerTitle}</h2>
          <p
            className={`text-[11px] ${
              isDark ? "text-gray-500" : "text-gray-400"
            }`}
          >
            Chat with {targetProfile?.display_name || "Peeap user"}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3 space-y-1 scrollbar-thin"
        >
          {loadingMessages && messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
          )}

          {!loadingMessages && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${
                  isDark ? "bg-gray-800" : "bg-gray-100"
                }`}
              >
                <MessageCircle
                  size={24}
                  className={isDark ? "text-gray-600" : "text-gray-400"}
                />
              </div>
              <p className={`text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                No messages yet
              </p>
              <p className={`text-xs mt-1 ${isDark ? "text-gray-600" : "text-gray-400"}`}>
                Say hello to {targetProfile?.display_name || "start the conversation"}!
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            const prev = messages[i - 1];
            const showDate = !prev || !isSameDay(prev.created_at, msg.created_at);
            const showSender = !prev || prev.sender_id !== msg.sender_id || showDate;
            const isOwn = msg.sender_id === user.id;
            const senderName =
              msg.sender?.display_name ||
              (isOwn ? user.name : targetProfile?.display_name || "User");

            if (msg.message_type === "system") {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <span
                    className={`text-xs px-3 py-1 rounded-full ${
                      isDark ? "bg-gray-800/60 text-gray-500" : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {msg.content}
                  </span>
                </div>
              );
            }

            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="flex items-center justify-center my-4">
                    <span
                      className={`text-[11px] font-medium px-3 py-1 rounded-full ${
                        isDark ? "bg-gray-800/60 text-gray-500" : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {formatDateSeparator(msg.created_at)}
                    </span>
                  </div>
                )}

                <div className={showSender && i > 0 ? "mt-3" : "mt-0.5"}>
                  <div className={`flex gap-2 ${isOwn ? "justify-end" : "justify-start"}`}>
                    {!isOwn && showSender && (
                      <div>
                        {targetProfile?.avatar_url ? (
                          <img
                            src={targetProfile.avatar_url}
                            alt={senderName}
                            className="w-7 h-7 rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-medium shrink-0 ${getColor(
                              msg.sender_id
                            )}`}
                          >
                            {getInitials(senderName)}
                          </div>
                        )}
                      </div>
                    )}
                    {!isOwn && !showSender && <div className="w-7" />}

                    <div
                      className={`max-w-[80%] flex flex-col ${
                        isOwn ? "items-end" : "items-start"
                      }`}
                    >
                      {!isOwn && showSender && (
                        <span
                          className={`text-[11px] ml-1 mb-0.5 ${
                            isDark ? "text-gray-500" : "text-gray-400"
                          }`}
                        >
                          {senderName}
                        </span>
                      )}

                      <div
                        className={`rounded-2xl px-3.5 py-2 ${
                          msg.is_deleted
                            ? isDark
                              ? "bg-gray-800/50 border border-gray-700/50"
                              : "bg-gray-100 border border-gray-200"
                            : isOwn
                            ? "bg-indigo-600 text-white"
                            : isDark
                            ? "bg-gray-800 text-gray-100"
                            : "bg-gray-100 text-gray-900"
                        } ${
                          isOwn
                            ? showSender ? "rounded-tr-sm" : ""
                            : showSender ? "rounded-tl-sm" : ""
                        }`}
                      >
                        {msg.is_deleted ? (
                          <p className={`text-sm italic ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                            Message deleted
                          </p>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {msg.content}
                          </p>
                        )}
                      </div>

                      <span
                        className={`text-[10px] mt-0.5 px-1 ${
                          isDark ? "text-gray-600" : "text-gray-400"
                        }`}
                      >
                        {formatMessageTime(msg.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>

        {showScrollDown && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
            className={`absolute bottom-3 right-3 p-1.5 rounded-full shadow-lg ${
              isDark
                ? "bg-gray-800 border border-gray-700 hover:bg-gray-700"
                : "bg-white border border-gray-200 hover:bg-gray-50"
            }`}
          >
            <ArrowDown size={16} className={isDark ? "text-gray-300" : "text-gray-600"} />
          </button>
        )}
      </div>

      {/* Input */}
      <div
        className={`px-3 py-2.5 border-t shrink-0 ${
          isDark ? "border-gray-800 bg-gray-900/50" : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className={`flex-1 px-3.5 py-2 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none ${
              isDark
                ? "bg-gray-800 border border-gray-700/50 text-white placeholder-gray-500"
                : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"
            }`}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white rounded-xl transition-colors shrink-0"
          >
            {sending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-gray-950">
          <Loader2 size={24} className="animate-spin text-indigo-500" />
        </div>
      }
    >
      <EmbedChatInner />
    </Suspense>
  );
}
