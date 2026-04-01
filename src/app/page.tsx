"use client";

import { ChatProvider } from "@/components/ChatProvider";
import ChatLayout from "@/components/chat/ChatLayout";

export default function ChatPage() {
  return (
    <ChatProvider>
      <ChatLayout />
    </ChatProvider>
  );
}
