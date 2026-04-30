"use client";

import { useState } from "react";
import {
  Check,
  X,
  Loader2,
  Clock,
  UserCheck,
  Send,
} from "lucide-react";
import { chatAPI } from "@/lib/api";
import Avatar from "@/components/ui/Avatar";
import type { FriendRequest } from "@/lib/types";

interface FriendRequestsListProps {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  onResponded: () => void;
}

export default function FriendRequestsList({
  incoming,
  outgoing,
  onResponded,
}: FriendRequestsListProps) {
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  async function handleRespond(requestId: string, action: "accept" | "reject") {
    setRespondingTo(requestId);
    try {
      await chatAPI.respondToFriendRequest(requestId, action);
      onResponded();
    } catch (err) {
      console.error("Failed to respond:", err);
    } finally {
      setRespondingTo(null);
    }
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="text-center py-8 px-4">
        <UserCheck size={28} className="mx-auto text-gray-700 mb-2" />
        <p className="text-gray-500 text-sm">No pending friend requests</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Incoming requests */}
      {incoming.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2">
            <UserCheck size={12} className="text-emerald-500" />
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
              Incoming Requests
            </span>
            <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {incoming.length}
            </span>
          </div>

          {incoming.map((req) => {
            const isResponding = respondingTo === req.id;
            const sender = req.sender;

            return (
              <div
                key={req.id}
                className="px-4 py-3 hover:bg-gray-800/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Avatar
                    src={sender?.avatar_url || null}
                    name={sender?.display_name || "User"}
                    id={req.sender_id}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">
                      {sender?.display_name || "Unknown"}
                    </p>
                    {req.message && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                        &ldquo;{req.message}&rdquo;
                      </p>
                    )}
                    <p className="text-[10px] text-gray-600 mt-1">
                      {formatTimeAgo(req.created_at)}
                    </p>
                  </div>

                  {isResponding ? (
                    <Loader2 size={16} className="animate-spin text-gray-400 mt-1" />
                  ) : (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleRespond(req.id, "accept")}
                        className="p-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 rounded-lg transition-colors"
                        title="Accept"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={() => handleRespond(req.id, "reject")}
                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                        title="Decline"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Outgoing requests */}
      {outgoing.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2">
            <Send size={12} className="text-gray-500" />
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
              Sent Requests
            </span>
          </div>

          {outgoing.map((req) => {
            const receiver = req.receiver;
            return (
              <div
                key={req.id}
                className="px-4 py-2.5 flex items-center gap-3 opacity-60"
              >
                <Avatar
                  src={receiver?.avatar_url || null}
                  name={receiver?.display_name || "User"}
                  id={req.receiver_id}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">
                    {receiver?.display_name || "Unknown"}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {formatTimeAgo(req.created_at)}
                  </p>
                </div>
                <span className="flex items-center gap-1 text-[11px] text-amber-400">
                  <Clock size={11} />
                  Pending
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
