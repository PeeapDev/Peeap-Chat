"use client";

import { useState, useRef, useEffect } from "react";
import {
  Check,
  CheckCheck,
  Trash2,
  MoreVertical,
  Download,
  X,
  SmilePlus,
  Reply,
  Mic,
  CornerUpRight,
  Pencil,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import PaymentCard from "@/components/chat/PaymentCard";
import EcommerceCard from "@/components/chat/EcommerceCard";
import { formatMessageTime, getUserDisplayName } from "@/lib/utils";
import type { Message } from "@/lib/types";

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  isGroupChat: boolean;
  onDelete?: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
  onReply?: (message: Message) => void;
  onReact?: (messageId: string, emoji: string) => void;
  replyToMessage?: Message | null;
}

const PAYMENT_TYPES = new Set([
  "payment_request",
  "payment_confirmation",
  "invoice",
  "receipt",
  "fee_notice",
  "salary_slip",
]);

const ECOMMERCE_TYPES = new Set([
  "product_card",
  "order_update",
  "shipping_update",
  "payment_link",
]);

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export default function MessageBubble({
  message,
  isOwn,
  showSender,
  isGroupChat,
  onDelete,
  onEdit,
  onReply,
  onReact,
  replyToMessage,
}: MessageBubbleProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  if (message.message_type === "system" || message.message_type === "announcement") {
    return (
      <div className="flex justify-center my-2">
        <span className="bg-gray-800/60 text-gray-400 text-xs px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.message_type === "slash_command_result") {
    return (
      <div className="flex justify-center my-2">
        <span className="bg-indigo-600/10 border border-indigo-500/20 text-indigo-300 text-xs px-3 py-1.5 rounded-lg">
          {message.content || "Command executed"}
        </span>
      </div>
    );
  }

  const isPayment = PAYMENT_TYPES.has(message.message_type);
  const isEcommerce = ECOMMERCE_TYPES.has(message.message_type);
  const senderName = getUserDisplayName(message.sender);
  const time = formatMessageTime(message.created_at);

  const imageUrl =
    message.message_type === "image" && message.attachments?.length > 0
      ? String((message.attachments[0] as Record<string, string>)?.url || "")
      : null;

  const fileInfo =
    message.message_type === "file" && message.attachments?.length > 0
      ? (message.attachments[0] as Record<string, unknown>)
      : (message.metadata as Record<string, unknown>);

  const hasReactions = message.reactions && message.reactions.length > 0;
  const canEdit =
    isOwn &&
    !message.is_deleted &&
    message.message_type === "text" &&
    Date.now() - new Date(message.created_at).getTime() < 15 * 60 * 1000;

  // Inline edit mode
  if (editing) {
    return (
      <div className={`flex gap-2 ${isOwn ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[75%] w-full">
          <div className="bg-gray-800 border border-indigo-500/50 rounded-2xl p-3">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full bg-transparent text-sm text-white resize-none focus:outline-none"
              rows={2}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={() => setEditing(false)}
                className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editText.trim() && editText.trim() !== message.content) {
                    onEdit?.(message.id, editText.trim());
                  }
                  setEditing(false);
                }}
                disabled={!editText.trim() || editText.trim() === message.content}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1 rounded-lg"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`flex gap-2 group ${isOwn ? "justify-end" : "justify-start"}`}
      >
        {!isOwn && isGroupChat && showSender && (
          <Avatar
            src={message.sender?.avatar_url}
            name={senderName}
            id={message.sender_id}
            size="sm"
          />
        )}
        {!isOwn && isGroupChat && !showSender && <div className="w-8" />}

        <div className={`max-w-[75%] ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
          {!isOwn && isGroupChat && showSender && (
            <span className="text-[11px] text-gray-500 ml-1 mb-0.5">
              {senderName}
            </span>
          )}

          <div className="relative group/bubble">
            {/* Action bar on hover */}
            {!message.is_deleted && (
              <div
                className={`absolute -top-7 ${
                  isOwn ? "right-0" : "left-0"
                } opacity-0 group-hover/bubble:opacity-100 transition-opacity z-10 flex items-center gap-0.5 bg-gray-800 border border-gray-700 rounded-lg p-0.5 shadow-lg`}
              >
                {onReact && (
                  <button
                    onClick={() => setShowReactions(!showReactions)}
                    className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200"
                    title="React"
                  >
                    <SmilePlus size={14} />
                  </button>
                )}
                {onReply && (
                  <button
                    onClick={() => onReply(message)}
                    className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200"
                    title="Reply"
                  >
                    <Reply size={14} />
                  </button>
                )}
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200"
                >
                  <MoreVertical size={14} />
                </button>
              </div>
            )}

            {/* Quick reactions popup */}
            {showReactions && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
                <div
                  className={`absolute -top-14 ${isOwn ? "right-0" : "left-0"} z-20 flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-full px-2 py-1.5 shadow-xl`}
                >
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        onReact?.(message.id, emoji);
                        setShowReactions(false);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-700 text-base transition-transform hover:scale-125"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Context menu */}
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div
                  className={`absolute z-20 ${
                    isOwn ? "right-0" : "left-0"
                  } top-6 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[130px]`}
                >
                  {onReply && (
                    <button
                      onClick={() => {
                        onReply(message);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700/50"
                    >
                      <CornerUpRight size={12} />
                      Reply
                    </button>
                  )}
                  {isOwn && onEdit && message.message_type === "text" && message.content && canEdit && (
                    <button
                      onClick={() => {
                        setEditText(message.content || "");
                        setEditing(true);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700/50"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                  )}
                  {isOwn && onDelete && (
                    <button
                      onClick={() => {
                        onDelete(message.id);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700/50"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Reply-to preview */}
            {replyToMessage && (
              <div
                className={`mb-1 px-3 py-1.5 rounded-lg border-l-2 border-indigo-500 ${
                  isOwn ? "bg-indigo-600/10" : "bg-gray-800/50"
                } max-w-full`}
              >
                <p className="text-[10px] text-indigo-400 font-medium">
                  {getUserDisplayName(replyToMessage.sender)}
                </p>
                <p className="text-[11px] text-gray-400 truncate">
                  {replyToMessage.is_deleted
                    ? "Deleted message"
                    : replyToMessage.content || `[${replyToMessage.message_type}]`}
                </p>
              </div>
            )}

            {/* Message content */}
            {isPayment ? (
              <PaymentCard message={message} isOwn={isOwn} />
            ) : isEcommerce ? (
              <EcommerceCard message={message} isOwn={isOwn} />
            ) : message.message_type === "voice_note" ? (
              <VoiceNote message={message} isOwn={isOwn} showSender={showSender} />
            ) : message.message_type === "image" && imageUrl ? (
              <div
                className={`rounded-2xl overflow-hidden cursor-pointer ${
                  isOwn
                    ? showSender ? "rounded-tr-sm" : ""
                    : showSender ? "rounded-tl-sm" : ""
                }`}
                onClick={() => setPreviewOpen(true)}
              >
                <div className="relative bg-gray-800 min-w-[180px] max-w-[280px]">
                  {!imgError ? (
                    <img
                      src={imageUrl}
                      alt="Shared image"
                      className={`w-full max-h-[280px] object-cover transition-opacity duration-300 ${
                        imgLoaded ? "opacity-100" : "opacity-0"
                      }`}
                      onLoad={() => setImgLoaded(true)}
                      onError={() => setImgError(true)}
                      loading="lazy"
                    />
                  ) : null}

                  {!imgLoaded && !imgError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-800/80 min-h-[120px]">
                      <div className="relative w-12 h-12">
                        <svg className="w-12 h-12 animate-spin" viewBox="0 0 48 48">
                          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(129,140,248,0.8)" strokeWidth="3" strokeDasharray="80 126" strokeLinecap="round" />
                        </svg>
                        <Download size={16} className="absolute inset-0 m-auto text-white/70" />
                      </div>
                    </div>
                  )}

                  {imgError && (
                    <div className="flex items-center justify-center bg-gray-800 min-h-[100px] p-4">
                      <div className="text-center">
                        <Download size={20} className="mx-auto text-gray-500 mb-1" />
                        <p className="text-xs text-gray-500">Failed to load</p>
                      </div>
                    </div>
                  )}

                  {message.content && (
                    <div className={`px-3 py-2 ${isOwn ? "bg-indigo-600" : "bg-gray-800"}`}>
                      <p className="text-sm text-white whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : message.message_type === "file" ? (
              <div
                className={`rounded-2xl px-3.5 py-2.5 ${
                  isOwn ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-100"
                } ${isOwn ? (showSender ? "rounded-tr-sm" : "") : (showSender ? "rounded-tl-sm" : "")}`}
              >
                <a
                  href={String(fileInfo?.url || "#")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 hover:opacity-80"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${
                    isOwn ? "bg-white/15" : "bg-gray-700"
                  }`}>
                    {String(fileInfo?.name || fileInfo?.file_name || "file")
                      .split(".")
                      .pop()
                      ?.toUpperCase()
                      .slice(0, 4) || "FILE"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {String(fileInfo?.name || fileInfo?.file_name || "File")}
                    </p>
                    <p className="text-[10px] opacity-60">
                      {fileInfo?.size || fileInfo?.file_size
                        ? `${Math.round(Number(fileInfo.size || fileInfo.file_size) / 1024)}KB`
                        : "Download"}
                    </p>
                  </div>
                  <Download size={16} className="opacity-60 shrink-0" />
                </a>
              </div>
            ) : (
              <div
                className={`rounded-2xl px-3.5 py-2 ${
                  message.is_deleted
                    ? "bg-gray-800/50 border border-gray-700/50"
                    : isOwn
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-100"
                } ${
                  isOwn
                    ? showSender ? "rounded-tr-sm" : ""
                    : showSender ? "rounded-tl-sm" : ""
                }`}
              >
                {message.is_deleted ? (
                  <p className="text-gray-500 text-sm italic">
                    This message was deleted
                  </p>
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                )}
              </div>
            )}

            {/* Reactions bar */}
            {hasReactions && (
              <div className="flex flex-wrap gap-1 mt-1 px-1">
                {message.reactions!.map((r) => (
                  <button
                    key={r.emoji}
                    onClick={() => onReact?.(message.id, r.emoji)}
                    className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700/50 rounded-full px-1.5 py-0.5 text-xs hover:border-indigo-500/50 transition-colors"
                  >
                    <span>{r.emoji}</span>
                    <span className="text-gray-400 text-[10px]">{r.count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Message footer */}
            <div
              className={`flex items-center gap-1 mt-0.5 px-1 ${
                isOwn ? "justify-end" : "justify-start"
              }`}
            >
              <span className="text-[10px] text-gray-500">{time}</span>
              {message.is_edited && (
                <span className="text-[10px] text-gray-600">edited</span>
              )}
              {isOwn && !message.is_deleted && (
                <span className="text-gray-500">
                  {message.status === "read" ? (
                    <CheckCheck size={12} className="text-indigo-400" />
                  ) : message.status === "delivered" ? (
                    <CheckCheck size={12} />
                  ) : (
                    <Check size={12} />
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen Image Preview */}
      {previewOpen && imageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setPreviewOpen(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
            onClick={() => setPreviewOpen(false)}
          >
            <X size={24} />
          </button>
          <a
            href={imageUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-4 left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
            onClick={(e) => e.stopPropagation()}
            title="Download"
          >
            <Download size={20} />
          </a>
          <img
            src={imageUrl}
            alt="Preview"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-4 text-center text-gray-400 text-xs">
            {senderName} &middot; {time}
          </div>
        </div>
      )}
    </>
  );
}

// ── Voice Note Bubble ────────────────────────────────────────

function VoiceNote({
  message,
  isOwn,
  showSender,
}: {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rc = (message.rich_content || message.metadata || {}) as Record<string, unknown>;
  const duration = Number(rc.duration || rc.duration_seconds || 0);
  const audioUrl = message.attachments?.length
    ? String((message.attachments[0] as Record<string, string>)?.url || "")
    : null;

  // Stop playback when the bubble unmounts so audio doesn't keep playing after
  // navigating away.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function formatDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  return (
    <div
      className={`rounded-2xl px-3.5 py-2.5 flex items-center gap-3 min-w-[200px] ${
        isOwn ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-100"
      } ${isOwn ? (showSender ? "rounded-tr-sm" : "") : (showSender ? "rounded-tl-sm" : "")}`}
    >
      <button
        onClick={() => {
          if (!audioUrl) return;
          // Pause the actual element that's playing (previously a fresh Audio
          // was created every click, so "pause" left the old one playing and
          // rapid clicks stacked overlapping playback).
          if (playing) {
            audioRef.current?.pause();
            setPlaying(false);
            return;
          }
          const audio = audioRef.current ?? (audioRef.current = new Audio(audioUrl));
          audio.currentTime = 0;
          audio.onended = () => setPlaying(false);
          void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        }}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
          isOwn ? "bg-white/20 hover:bg-white/30" : "bg-gray-700 hover:bg-gray-600"
        } transition-colors`}
      >
        {playing ? (
          <div className="flex gap-0.5">
            <span className="w-0.5 h-3 bg-current rounded-full animate-pulse" />
            <span className="w-0.5 h-3 bg-current rounded-full animate-pulse [animation-delay:150ms]" />
          </div>
        ) : (
          <Mic size={16} />
        )}
      </button>

      {/* Waveform placeholder */}
      <div className="flex-1 flex items-center gap-[2px] h-6">
        {Array.from({ length: 24 }, (_, i) => (
          <div
            key={i}
            className={`w-[3px] rounded-full ${isOwn ? "bg-white/40" : "bg-gray-600"}`}
            style={{
              height: `${Math.max(4, Math.sin(i * 0.6) * 12 + Math.random() * 8 + 4)}px`,
            }}
          />
        ))}
      </div>

      <span className="text-[11px] opacity-60 shrink-0">
        {duration > 0 ? formatDuration(duration) : "0:00"}
      </span>
    </div>
  );
}
