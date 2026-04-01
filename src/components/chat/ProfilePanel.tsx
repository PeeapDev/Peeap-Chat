"use client";

import { useState, useEffect } from "react";
import {
  X,
  Mail,
  Phone,
  Store,
  ExternalLink,
  Shield,
  Calendar,
  Loader2,
  ShoppingBag,
  Crown,
  BellOff,
  Ban,
  User,
} from "lucide-react";
import { useChatContext } from "@/components/ChatProvider";

interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  image_url: string | null;
  slug: string | null;
  url: string | null;
}

interface MerchantInfo {
  id: string;
  business_name: string;
  category: string;
  logo: string | null;
  description: string | null;
  slug: string | null;
  is_verified: boolean;
  store_url: string | null;
}

interface UserProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  account_type: string;
  roles: string[];
  joined_at: string;
  merchant?: MerchantInfo;
  products?: Product[];
}

interface ProfilePanelProps {
  userId: string;
  onClose: () => void;
  onSendProduct?: (productId: string) => void;
}

export default function ProfilePanel({
  userId,
  onClose,
  onSendProduct,
}: ProfilePanelProps) {
  const { token } = useChatContext();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !token) return;

    setLoading(true);
    setError(null);

    fetch(`/api/users/${userId}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load profile");
        return res.json();
      })
      .then((data) => setProfile(data.profile))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [userId, token]);

  const isMerchant = profile?.merchant != null;
  const joinDate = profile?.joined_at
    ? new Date(profile.joined_at).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="w-80 lg:w-96 border-l border-gray-800 bg-gray-900 flex flex-col h-full shrink-0 overflow-hidden">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-gray-800 shrink-0">
        <h3 className="text-sm font-semibold text-white">Contact Info</h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"
        >
          <X size={18} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-indigo-500" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-red-400 text-sm text-center">{error}</p>
        </div>
      ) : profile ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Avatar + Name */}
          <div className="flex flex-col items-center pt-6 pb-4 px-4">
            <div className="relative shrink-0 mb-4">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  className="w-24 h-24 rounded-full object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-3xl">
                  {profile.display_name?.[0]?.toUpperCase() || "?"}
                </div>
              )}
            </div>
            <h2 className="text-lg font-semibold text-white text-center">
              {profile.display_name}
            </h2>
            {profile.username && (
              <p className="text-sm text-gray-400">@{profile.username}</p>
            )}
            {profile.bio && (
              <p className="text-xs text-gray-500 text-center mt-2 max-w-[240px]">
                {profile.bio}
              </p>
            )}

            {/* Badges */}
            <div className="flex items-center gap-2 mt-3">
              {isMerchant && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-600/20 border border-violet-500/30 text-violet-300 text-[11px] font-medium rounded-full">
                  <Store size={10} />
                  Merchant
                </span>
              )}
              {profile.merchant?.is_verified && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium rounded-full">
                  <Shield size={10} />
                  Verified
                </span>
              )}
              {profile.roles.includes("admin") && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-600/20 border border-amber-500/30 text-amber-300 text-[11px] font-medium rounded-full">
                  <Crown size={10} />
                  Admin
                </span>
              )}
            </div>
          </div>

          {/* Contact Details */}
          <div className="px-4 py-3 border-t border-gray-800/50">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">
              Contact
            </p>
            {profile.phone && (
              <div className="flex items-center gap-3 py-2">
                <Phone size={16} className="text-gray-500 shrink-0" />
                <div>
                  <p className="text-sm text-white">{profile.phone}</p>
                  <p className="text-[11px] text-gray-500">Phone</p>
                </div>
              </div>
            )}
            {profile.email && (
              <div className="flex items-center gap-3 py-2">
                <Mail size={16} className="text-gray-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{profile.email}</p>
                  <p className="text-[11px] text-gray-500">Email</p>
                </div>
              </div>
            )}
            {joinDate && (
              <div className="flex items-center gap-3 py-2">
                <Calendar size={16} className="text-gray-500 shrink-0" />
                <div>
                  <p className="text-sm text-white">Joined {joinDate}</p>
                  <p className="text-[11px] text-gray-500">Member since</p>
                </div>
              </div>
            )}
          </div>

          {/* Merchant / Shop Section */}
          {profile.merchant && (
            <div className="px-4 py-3 border-t border-gray-800/50">
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">
                Shop
              </p>
              <div className="flex items-center gap-3 py-2">
                {profile.merchant.logo ? (
                  <img
                    src={profile.merchant.logo}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-violet-600/20 flex items-center justify-center">
                    <Store size={18} className="text-violet-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {profile.merchant.business_name}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {profile.merchant.category}
                  </p>
                </div>
                {profile.merchant.store_url && (
                  <a
                    href={profile.merchant.store_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-indigo-400 transition-colors"
                    title="Visit store"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
              {profile.merchant.description && (
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  {profile.merchant.description}
                </p>
              )}
            </div>
          )}

          {/* Products */}
          {profile.products && profile.products.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-800/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                  Products
                </p>
                {profile.merchant?.store_url && (
                  <a
                    href={profile.merchant.store_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-indigo-400 hover:underline"
                  >
                    View all
                  </a>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {profile.products.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => onSendProduct?.(product.id)}
                    className="group bg-gray-800 rounded-xl overflow-hidden hover:ring-1 hover:ring-indigo-500/50 transition-all text-left"
                    title="Send product in chat"
                  >
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-20 object-cover"
                      />
                    ) : (
                      <div className="w-full h-20 bg-gray-700 flex items-center justify-center">
                        <ShoppingBag
                          size={20}
                          className="text-gray-500"
                        />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-[11px] text-white truncate">
                        {product.name}
                      </p>
                      <p className="text-[11px] text-indigo-400 font-medium">
                        {product.currency}{" "}
                        {product.price.toLocaleString()}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-4 py-3 border-t border-gray-800/50 space-y-1">
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800 text-gray-400 text-sm transition-colors">
              <BellOff size={16} />
              Mute notifications
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800 text-red-400 text-sm transition-colors">
              <Ban size={16} />
              Block user
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
