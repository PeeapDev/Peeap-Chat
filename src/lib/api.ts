// ============================================================
// Peeap Chat - Client-side API wrapper
// ============================================================

import type {
  Conversation,
  Message,
  ChatUser,
  MessageType,
  UnreadInfo,
  FriendRequest,
  Contact,
} from "./types";

class ChatAPI {
  private token: string = "";

  setToken(token: string) {
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  private async request<T>(url: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...opts,
      headers: { ...this.headers(), ...opts?.headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // ── Conversations ──────────────────────────────────────────

  async getConversations(params?: {
    limit?: number;
    offset?: number;
    type?: string;
    status?: string;
    pinned?: boolean;
  }): Promise<{ conversations: Conversation[] }> {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.type) q.set("type", params.type);
    if (params?.status) q.set("status", params.status);
    if (params?.pinned !== undefined) q.set("pinned", String(params.pinned));
    const qs = q.toString();
    return this.request(`/api/conversations${qs ? `?${qs}` : ""}`);
  }

  async getConversation(
    id: string
  ): Promise<{ conversation: Conversation }> {
    return this.request(`/api/conversations/${id}`);
  }

  async createConversation(data: {
    type: string;
    name?: string;
    member_ids: string[];
    metadata?: Record<string, unknown>;
    is_announcement_only?: boolean;
  }): Promise<{ conversation: Conversation }> {
    return this.request("/api/conversations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateConversation(
    id: string,
    data: {
      name?: string;
      status?: string;
      priority?: string;
      is_announcement_only?: boolean;
    }
  ): Promise<{ conversation: Conversation }> {
    return this.request(`/api/conversations/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async archiveConversation(id: string): Promise<void> {
    await this.request(`/api/conversations/${id}`, { method: "DELETE" });
  }

  // ── Messages ───────────────────────────────────────────────

  async getMessages(
    conversationId: string,
    params?: { limit?: number; before?: string; type?: string }
  ): Promise<{ messages: Message[] }> {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.before) q.set("before", params.before);
    if (params?.type) q.set("type", params.type);
    const qs = q.toString();
    return this.request(
      `/api/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`
    );
  }

  async sendMessage(
    conversationId: string,
    data: {
      content?: string;
      message_type?: MessageType;
      rich_content?: Record<string, unknown>;
      attachments?: unknown[];
      metadata?: Record<string, unknown>;
      reply_to?: string;
      // E2EE payload (set instead of `content` for encrypted messages)
      is_encrypted?: boolean;
      encrypted_content?: string;
      encryption_metadata?: Record<string, unknown>;
    }
  ): Promise<{ message: Message }> {
    return this.request(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async editMessage(
    messageId: string,
    content: string
  ): Promise<{ message: Message }> {
    return this.request(`/api/messages/${messageId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.request(`/api/messages/${messageId}`, { method: "DELETE" });
  }

  // ── Members ────────────────────────────────────────────────

  async getMembers(
    conversationId: string
  ): Promise<{ members: Array<{ user_id: string; role: string; profile?: ChatUser }> }> {
    return this.request(`/api/conversations/${conversationId}/members`);
  }

  async addMembers(
    conversationId: string,
    userIds: string[],
    role?: string
  ): Promise<void> {
    await this.request(`/api/conversations/${conversationId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds, role }),
    });
  }

  async removeMember(conversationId: string, userIds: string[]): Promise<void> {
    await this.request(`/api/conversations/${conversationId}/members`, {
      method: "DELETE",
      body: JSON.stringify({ user_ids: userIds }),
    });
  }

  // ── Read Status ────────────────────────────────────────────

  async markAsRead(conversationId: string): Promise<void> {
    await this.request(`/api/conversations/${conversationId}/read`, {
      method: "PUT",
    });
  }

  // ── Users ──────────────────────────────────────────────────

  async searchUsers(
    query: string,
    limit?: number
  ): Promise<{ users: ChatUser[] }> {
    const q = new URLSearchParams({ q: query });
    if (limit) q.set("limit", String(limit));
    return this.request(`/api/users/search?${q.toString()}`);
  }

  // ── Unread Count ───────────────────────────────────────────

  async getUnreadCount(): Promise<UnreadInfo> {
    return this.request("/api/unread-count");
  }

  // ── Friends ───────────────────────────────────────────────

  async getFriends(): Promise<{ friends: Contact[] }> {
    return this.request("/api/friends");
  }

  async removeFriend(userId: string): Promise<void> {
    await this.request(`/api/friends?userId=${userId}`, { method: "DELETE" });
  }

  async sendFriendRequest(receiverId: string, message?: string): Promise<{ request?: FriendRequest; status?: string; message?: string }> {
    return this.request("/api/friends/request", {
      method: "POST",
      body: JSON.stringify({ receiver_id: receiverId, message }),
    });
  }

  async getFriendRequests(): Promise<{
    incoming: FriendRequest[];
    outgoing: FriendRequest[];
    incoming_count: number;
  }> {
    return this.request("/api/friends/request");
  }

  async respondToFriendRequest(requestId: string, action: "accept" | "reject"): Promise<{ status: string }> {
    return this.request(`/api/friends/request/${requestId}/respond`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  }
}

export const chatAPI = new ChatAPI();
