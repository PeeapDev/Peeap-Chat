"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Paperclip,
  DollarSign,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  FileText,
  Loader2,
  Image as ImageIcon,
  File as FileIcon,
  Camera,
  SwatchBook,
} from "lucide-react";
import { useChatContext } from "@/components/ChatProvider";
import { useTypingBroadcast } from "@/components/chat/TypingIndicator";
import Avatar from "@/components/ui/Avatar";
import { getUserDisplayName } from "@/lib/utils";
import type { ChatUser, Message } from "@/lib/types";

interface MessageInputProps {
  replyTo?: Message | null;
  onClearReply?: () => void;
}

// Slash commands available
const SLASH_COMMANDS = [
  { cmd: "send", label: "Send Money", icon: <ArrowUpRight size={16} />, desc: "Send money to this user" },
  { cmd: "request", label: "Request Money", icon: <ArrowDownLeft size={16} />, desc: "Request a payment" },
  { cmd: "invoice", label: "Invoice", icon: <FileText size={16} />, desc: "Create and send an invoice" },
  { cmd: "transaction", label: "Transactions", icon: <SwatchBook size={16} />, desc: "View recent transactions" },
];

export default function MessageInput({ replyTo, onClearReply }: MessageInputProps) {
  const { sendMessage, activeConversation, activeConversationId, currentUserId, token } = useChatContext();
  const { broadcastTyping } = useTypingBroadcast();
  const [text, setText] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [showSlash, setShowSlash] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // @ mention state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionResults, setMentionResults] = useState<ChatUser[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const mentionTimeout = useRef<ReturnType<typeof setTimeout>>();

  const canSend = (() => {
    if (!activeConversation) return false;
    if (!activeConversation.is_announcement_only) return true;
    const me = activeConversation.members?.find((m) => m.user_id === currentUserId);
    return me?.role === "owner" || me?.role === "admin";
  })();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [text]);

  // @ mention search
  useEffect(() => {
    if (!showMentions || mentionQuery.length < 1) {
      setMentionResults([]);
      return;
    }
    clearTimeout(mentionTimeout.current);
    mentionTimeout.current = setTimeout(async () => {
      setMentionLoading(true);
      try {
        const memberMatches = (activeConversation?.members || [])
          .filter((m) => m.user_id !== currentUserId && m.profile)
          .filter((m) =>
            (m.profile?.display_name || "")
              .toLowerCase()
              .includes(mentionQuery.toLowerCase())
          )
          .map((m) => m.profile!);

        if (memberMatches.length > 0) {
          setMentionResults(memberMatches);
        } else if (token) {
          const res = await fetch(
            `/api/users/search?q=${encodeURIComponent(mentionQuery)}&limit=6`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.ok) {
            const data = await res.json();
            setMentionResults(
              (data.users || []).filter((u: ChatUser) => u.id !== currentUserId)
            );
          }
        }
      } catch {
        setMentionResults([]);
      } finally {
        setMentionLoading(false);
      }
    }, 200);
    return () => clearTimeout(mentionTimeout.current);
  }, [mentionQuery, showMentions, activeConversation, currentUserId, token]);

  function handleTextChange(newText: string) {
    setText(newText);
    broadcastTyping();

    // Detect @ trigger
    const cursorPos = textareaRef.current?.selectionStart || newText.length;
    const textBeforeCursor = newText.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setShowMentions(true);
      setMentionQuery(atMatch[1]);
    } else {
      setShowMentions(false);
      setMentionQuery("");
    }

    // Detect / trigger
    if (newText.startsWith("/")) {
      setShowSlash(true);
      setSlashQuery(newText.slice(1).toLowerCase());
    } else {
      setShowSlash(false);
    }
  }

  function insertMention(user: ChatUser) {
    const cursorPos = textareaRef.current?.selectionStart || text.length;
    const textBefore = text.slice(0, cursorPos);
    const textAfter = text.slice(cursorPos);
    const atIndex = textBefore.lastIndexOf("@");
    const newText =
      textBefore.slice(0, atIndex) +
      `@${user.display_name} ` +
      textAfter;
    setText(newText);
    setShowMentions(false);
    setMentionQuery("");
    textareaRef.current?.focus();
  }

  const filteredCommands = slashQuery
    ? SLASH_COMMANDS.filter(
        (c) => c.cmd.includes(slashQuery) || c.label.toLowerCase().includes(slashQuery)
      )
    : SLASH_COMMANDS;

  function handleSlashCommand(cmd: string) {
    setText("");
    setShowSlash(false);

    switch (cmd) {
      case "send":
        handlePaymentAction("send_money");
        break;
      case "request":
        handlePaymentAction("request_money");
        break;
      case "invoice":
        handlePaymentAction("invoice");
        break;
      case "transaction":
        sendMessage("/transaction", "text");
        break;
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    setShowMentions(false);
    setShowSlash(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const extra: Record<string, unknown> = {};
    if (replyTo) {
      extra.reply_to = replyTo.id;
      onClearReply?.();
    }
    await sendMessage(trimmed, "text", Object.keys(extra).length > 0 ? extra : undefined);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handlePaymentAction(type: "send_money" | "request_money" | "invoice") {
    setShowPayment(false);
    const labels = {
      send_money: "Payment sent",
      request_money: "Payment requested",
      invoice: "Invoice sent",
    };
    const messageType = type === "invoice" ? "invoice" : "payment_request";
    await sendMessage(labels[type], messageType, {
      rich_content: {
        type,
        amount: 0,
        currency: "SLE",
        status: "pending",
      },
    });
  }

  // ── File/Image Upload ──
  const uploadFile = useCallback(async (file: File, messageType: "image" | "file") => {
    if (!activeConversationId || !token) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversation_id", activeConversationId);
      formData.append("file_name", file.name);
      formData.append("file_type", messageType);
      formData.append("mime_type", file.type);

      const res = await fetch("/api/media/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json();
      const publicUrl = data.public_url;

      await sendMessage(
        messageType === "image" ? "" : file.name,
        messageType,
        {
          attachments: [
            { url: publicUrl, name: file.name, type: file.type, size: file.size },
          ],
        }
      );
    } catch {
      // show error inline
    } finally {
      setUploading(false);
    }
  }, [activeConversationId, token, sendMessage]);

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file, "image");
    e.target.value = "";
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const isImage = file.type.startsWith("image/");
      uploadFile(file, isImage ? "image" : "file");
    }
    e.target.value = "";
  }

  if (!canSend) {
    return (
      <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/50">
        <p className="text-gray-500 text-sm text-center">
          Only admins can send messages in this channel
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-800 bg-gray-900/50 relative">
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleImageSelect}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Slash command suggestions */}
      {showSlash && filteredCommands.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mx-4 mb-1 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700/50">
            <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">Commands</span>
          </div>
          {filteredCommands.map((c) => (
            <button
              key={c.cmd}
              onClick={() => handleSlashCommand(c.cmd)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-600/15 flex items-center justify-center text-indigo-400">
                {c.icon}
              </div>
              <div className="text-left">
                <p className="text-sm text-white">/{c.cmd}</p>
                <p className="text-[11px] text-gray-500">{c.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* @ Mention dropdown */}
      {showMentions && (mentionResults.length > 0 || mentionLoading) && (
        <div className="absolute bottom-full left-0 right-0 mx-4 mb-1 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto">
          {mentionLoading && mentionResults.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-3 text-gray-500 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Searching...
            </div>
          )}
          {mentionResults.map((user) => (
            <button
              key={user.id}
              onClick={() => insertMention(user)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors"
            >
              <Avatar
                src={user.avatar_url}
                name={user.display_name}
                id={user.id}
                size="sm"
              />
              <div className="text-left min-w-0">
                <p className="text-sm text-white truncate">{user.display_name}</p>
                <p className="text-[11px] text-gray-500 truncate">
                  {user.phone || user.email}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Reply-to preview */}
      {replyTo && (
        <div className="px-4 pt-3 flex items-center gap-2">
          <div className="flex-1 border-l-2 border-indigo-500 pl-3 py-1 bg-gray-800/50 rounded-r-lg">
            <p className="text-[11px] text-indigo-400 font-medium">
              Replying to {getUserDisplayName(replyTo.sender)}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {replyTo.is_deleted
                ? "Deleted message"
                : replyTo.content || `[${replyTo.message_type}]`}
            </p>
          </div>
          <button
            onClick={onClearReply}
            className="p-1 text-gray-500 hover:text-gray-300 rounded"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="px-4 pt-2 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin text-indigo-400" />
          Uploading...
        </div>
      )}

      {/* Payment actions popup */}
      {showPayment && (
        <div className="px-4 pt-3 flex gap-2 flex-wrap">
          <button
            onClick={() => handlePaymentAction("send_money")}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600/20 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs font-medium hover:bg-emerald-600/30 transition-colors"
          >
            <ArrowUpRight size={14} />
            Send Money
          </button>
          <button
            onClick={() => handlePaymentAction("request_money")}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 border border-amber-500/30 rounded-lg text-amber-400 text-xs font-medium hover:bg-amber-600/30 transition-colors"
          >
            <ArrowDownLeft size={14} />
            Request
          </button>
          <button
            onClick={() => handlePaymentAction("invoice")}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400 text-xs font-medium hover:bg-blue-600/30 transition-colors"
          >
            <FileText size={14} />
            Invoice
          </button>
          <button
            onClick={() => setShowPayment(false)}
            className="ml-auto p-2 text-gray-500 hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="px-4 py-3 flex items-end gap-2">
        {/* Attachment menu */}
        <div className="relative group/attach">
          <button
            className="p-2 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors shrink-0"
            title="Attach"
          >
            <Paperclip size={20} />
          </button>
          {/* Dropdown on hover */}
          <div className="hidden group-hover/attach:block absolute bottom-full left-0 mb-2 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden min-w-[160px]">
            <button
              onClick={() => imageInputRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 text-sm text-gray-200"
            >
              <Camera size={16} className="text-rose-400" />
              Photo
            </button>
            <button
              onClick={() => {
                // Reset to accept all images
                if (imageInputRef.current) {
                  imageInputRef.current.removeAttribute("capture");
                  imageInputRef.current.click();
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 text-sm text-gray-200"
            >
              <ImageIcon size={16} className="text-indigo-400" />
              Gallery
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 text-sm text-gray-200"
            >
              <FileIcon size={16} className="text-amber-400" />
              Document
            </button>
          </div>
        </div>

        {/* Payment */}
        <button
          onClick={() => setShowPayment(!showPayment)}
          className={`p-2 rounded-lg transition-colors shrink-0 ${
            showPayment
              ? "text-indigo-400 bg-indigo-600/20"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
          }`}
          title="Payment actions"
        >
          <DollarSign size={20} />
        </button>

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (/ for commands)"
            rows={1}
            className="w-full bg-gray-800 border border-gray-700/50 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none scrollbar-thin"
          />
        </div>

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || uploading}
          className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white rounded-xl transition-colors shrink-0"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
