"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  Search,
  Loader2,
  UserPlus,
  QrCode,
  Check,
  Send,
} from "lucide-react";
import { chatAPI } from "@/lib/api";
import { useChatContext } from "@/components/ChatProvider";
import Avatar from "@/components/ui/Avatar";
import type { ChatUser } from "@/lib/types";

interface AddFriendModalProps {
  open: boolean;
  onClose: () => void;
  onRequestSent?: () => void;
}

export default function AddFriendModal({
  open,
  onClose,
  onRequestSent,
}: AddFriendModalProps) {
  const { currentUserId, currentUser } = useChatContext();

  const [tab, setTab] = useState<"search" | "qr">("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [showMessageFor, setShowMessageFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTab("search");
      setQuery("");
      setResults([]);
      setSentTo(new Set());
      setMessage("");
      setShowMessageFor(null);
      setError("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Search users
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }

    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await chatAPI.searchUsers(query, 20);
        setResults(
          (data.users || []).filter((u) => u.id !== currentUserId)
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [query, currentUserId]);

  async function handleSendRequest(userId: string) {
    setSendingTo(userId);
    setError("");
    try {
      const res = await chatAPI.sendFriendRequest(userId, message || undefined);
      setSentTo((prev) => new Set(prev).add(userId));
      setShowMessageFor(null);
      setMessage("");
      onRequestSent?.();

      if (res.status === "accepted") {
        setError("");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send request";
      setError(msg);
    } finally {
      setSendingTo(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md mx-4 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-indigo-400" />
            <h2 className="text-base font-semibold text-white">Add Friend</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setTab("search")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
              tab === "search"
                ? "text-indigo-400 border-b-2 border-indigo-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <Search size={14} />
            Search
          </button>
          <button
            onClick={() => setTab("qr")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
              tab === "qr"
                ? "text-indigo-400 border-b-2 border-indigo-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <QrCode size={14} />
            My QR Code
          </button>
        </div>

        {tab === "search" ? (
          <div className="p-4 space-y-3">
            {/* Search input */}
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, phone, or email..."
                className="w-full bg-gray-800 border border-gray-700/50 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              {searching && (
                <Loader2
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-500"
                />
              )}
            </div>

            {/* Results */}
            <div className="max-h-72 overflow-y-auto space-y-0.5 scrollbar-thin">
              {results.length === 0 && query.trim().length >= 2 && !searching && (
                <p className="text-gray-500 text-sm text-center py-6">
                  No users found
                </p>
              )}

              {!query.trim() && (
                <div className="text-center py-8">
                  <UserPlus size={32} className="mx-auto text-gray-700 mb-2" />
                  <p className="text-gray-500 text-sm">
                    Search for people by name, phone, or email
                  </p>
                </div>
              )}

              {results.map((user) => {
                const isSent = sentTo.has(user.id);
                const isSending = sendingTo === user.id;
                const isExpanded = showMessageFor === user.id;

                return (
                  <div key={user.id} className="rounded-lg border border-transparent hover:border-gray-700/50 hover:bg-gray-800/40 transition-colors">
                    <div className="flex items-center gap-3 px-3 py-2.5">
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

                      {isSent ? (
                        <span className="flex items-center gap-1 text-emerald-400 text-xs">
                          <Check size={14} />
                          Sent
                        </span>
                      ) : isSending ? (
                        <Loader2 size={16} className="animate-spin text-indigo-400" />
                      ) : (
                        <button
                          onClick={() => {
                            if (isExpanded) {
                              handleSendRequest(user.id);
                            } else {
                              setShowMessageFor(user.id);
                              setMessage("");
                            }
                          }}
                          className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs font-medium px-2 py-1 rounded-md hover:bg-indigo-500/10 transition-colors"
                        >
                          <UserPlus size={14} />
                          Add
                        </button>
                      )}
                    </div>

                    {/* Expandable message input */}
                    {isExpanded && !isSent && (
                      <div className="px-3 pb-2.5 flex gap-2">
                        <input
                          type="text"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder="Say hi! (optional)"
                          maxLength={200}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSendRequest(user.id);
                            if (e.key === "Escape") setShowMessageFor(null);
                          }}
                          className="flex-1 bg-gray-800 border border-gray-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        />
                        <button
                          onClick={() => handleSendRequest(user.id)}
                          disabled={isSending}
                          className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                        >
                          <Send size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="text-red-400 text-xs text-center">{error}</p>
            )}
          </div>
        ) : (
          /* QR Code tab */
          <div className="p-6 flex flex-col items-center">
            <div className="w-48 h-48 bg-white rounded-2xl p-3 mb-4 flex items-center justify-center">
              {/* QR Code - encodes the user's profile URL for scanning */}
              <div className="w-full h-full bg-gray-100 rounded-lg flex items-center justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=168x168&data=${encodeURIComponent(
                    `https://chat.peeap.com?add_friend=${currentUserId}`
                  )}`}
                  alt="My QR Code"
                  className="w-full h-full rounded-lg"
                />
              </div>
            </div>

            <div className="text-center">
              <p className="text-white font-medium">
                {currentUser?.display_name || "My Profile"}
              </p>
              <p className="text-gray-500 text-xs mt-1">
                Scan this code to add me as a friend
              </p>
            </div>

            <div className="mt-4 px-4 py-2.5 bg-gray-800 rounded-lg flex items-center gap-2">
              <span className="text-xs text-gray-400">ID:</span>
              <code className="text-xs text-indigo-400 font-mono">
                {currentUserId.slice(0, 8)}...{currentUserId.slice(-4)}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
