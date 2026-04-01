"use client";

import { useState } from "react";
import { useChatContext } from "@/components/ChatProvider";
import Sidebar from "./Sidebar";
import ChatPanel from "./ChatPanel";
import QRLoginScreen from "./QRLoginScreen";
import NewChatModal from "@/components/modals/NewChatModal";
import { AlertCircle, X } from "lucide-react";

export default function ChatLayout() {
  const { isAuthenticated, error, clearError, showSidebar, handleQRLogin } = useChatContext();
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Show QR login when not authenticated
  if (!isAuthenticated) {
    return (
      <div className="h-screen flex overflow-hidden bg-gray-950">
        <QRLoginScreen onAuthenticated={handleQRLogin} />
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-gray-950">
      {/* Error toast */}
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
          <div className="flex items-center gap-2 bg-red-900/90 border border-red-700/50 text-red-200 px-4 py-2.5 rounded-xl shadow-lg text-sm backdrop-blur-sm">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button
              onClick={clearError}
              className="p-0.5 hover:bg-red-800 rounded ml-1"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div
        className={`w-full md:w-80 lg:w-96 shrink-0 border-r border-gray-800/80 ${
          showSidebar ? "block" : "hidden md:block"
        }`}
      >
        <Sidebar onNewChat={() => setNewChatOpen(true)} />
      </div>

      {/* Chat panel */}
      <div
        className={`flex-1 min-w-0 ${
          showSidebar ? "hidden md:flex" : "flex"
        }`}
      >
        <ChatPanel />
      </div>

      {/* New chat modal */}
      <NewChatModal open={newChatOpen} onClose={() => setNewChatOpen(false)} />
    </div>
  );
}
