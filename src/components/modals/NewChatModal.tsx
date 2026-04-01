"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  Search,
  Users,
  MessageSquare,
  Loader2,
  Check,
} from "lucide-react";
import { chatAPI } from "@/lib/api";
import { useChatContext } from "@/components/ChatProvider";
import Avatar from "@/components/ui/Avatar";
import type { ChatUser } from "@/lib/types";

interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
}

export default function NewChatModal({ open, onClose }: NewChatModalProps) {
  const { createConversation, selectConversation, currentUserId } =
    useChatContext();

  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ChatUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode("direct");
      setQuery("");
      setResults([]);
      setSelected([]);
      setGroupName("");
      setError("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
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

  function toggleUser(user: ChatUser) {
    setSelected((prev) => {
      const exists = prev.find((u) => u.id === user.id);
      if (exists) return prev.filter((u) => u.id !== user.id);
      if (mode === "direct") return [user];
      return [...prev, user];
    });
  }

  async function handleCreate() {
    if (selected.length === 0) return;
    setCreating(true);
    setError("");
    try {
      const type = mode === "group" ? "group" : "direct";
      const memberIds = selected.map((u) => u.id);
      const conv = await createConversation(
        type,
        memberIds,
        mode === "group" ? groupName || undefined : undefined
      );
      selectConversation(conv.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create conversation");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">
            New Conversation
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => {
              setMode("direct");
              setSelected([]);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
              mode === "direct"
                ? "text-indigo-400 border-b-2 border-indigo-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <MessageSquare size={14} />
            Direct
          </button>
          <button
            onClick={() => setMode("group")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
              mode === "group"
                ? "text-indigo-400 border-b-2 border-indigo-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <Users size={14} />
            Group
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Group name */}
          {mode === "group" && (
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name (optional)"
              className="w-full bg-gray-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
          )}

          {/* Selected users */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1 bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-xs rounded-full pl-2.5 pr-1.5 py-1"
                >
                  {user.display_name}
                  <button
                    onClick={() => toggleUser(user)}
                    className="p-0.5 hover:bg-indigo-500/30 rounded-full"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search */}
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
              placeholder="Search by name, email, or phone..."
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
          <div className="max-h-56 overflow-y-auto space-y-0.5 scrollbar-thin">
            {results.length === 0 && query.trim() && !searching && (
              <p className="text-gray-500 text-sm text-center py-4">
                No users found
              </p>
            )}
            {results.map((user) => {
              const isSelected = selected.some((u) => u.id === user.id);
              return (
                <button
                  key={user.id}
                  onClick={() => toggleUser(user)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isSelected
                      ? "bg-indigo-600/15 border border-indigo-500/30"
                      : "hover:bg-gray-800 border border-transparent"
                  }`}
                >
                  <Avatar
                    src={user.avatar_url}
                    name={user.display_name}
                    id={user.id}
                    size="sm"
                  />
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm text-white truncate">
                      {user.display_name}
                    </p>
                    {(user.email || user.phone) && (
                      <p className="text-[11px] text-gray-500 truncate">
                        {user.email || user.phone}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <Check size={16} className="text-indigo-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-400 text-xs text-center">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleCreate}
            disabled={selected.length === 0 || creating}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white font-medium rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
          >
            {creating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                {mode === "direct" ? "Start Chat" : "Create Group"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
