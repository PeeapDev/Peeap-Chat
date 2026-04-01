"use client";

import {
  ShoppingBag,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  MapPin,
  ExternalLink,
  Tag,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Message } from "@/lib/types";

interface EcommerceCardProps {
  message: Message;
  isOwn: boolean;
}

export default function EcommerceCard({ message, isOwn }: EcommerceCardProps) {
  const rc = (message.rich_content || message.metadata || {}) as Record<string, unknown>;

  if (message.message_type === "product_card") {
    return <ProductCard rc={rc} />;
  }

  if (message.message_type === "order_update") {
    return <OrderCard rc={rc} />;
  }

  if (message.message_type === "shipping_update") {
    return <ShippingCard rc={rc} content={message.content} />;
  }

  if (message.message_type === "payment_link") {
    return <PaymentLinkCard rc={rc} content={message.content} />;
  }

  return null;
}

// ── Product Card ─────────────────────────────────────────────

function ProductCard({ rc }: { rc: Record<string, unknown> }) {
  const name = String(rc.name || rc.product_name || "Product");
  const price = Number(rc.price || 0);
  const currency = String(rc.currency || "SLE");
  const imageUrl = rc.image_url ? String(rc.image_url) : null;
  const description = rc.description ? String(rc.description) : null;
  const storeUrl = rc.url || rc.store_url || rc.product_url;

  return (
    <div className="w-[260px] rounded-2xl border border-gray-700/50 bg-gray-800 overflow-hidden">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          className="w-full h-36 object-cover"
        />
      ) : (
        <div className="w-full h-28 bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
          <ShoppingBag size={32} className="text-gray-600" />
        </div>
      )}
      <div className="p-3">
        <p className="text-sm font-medium text-white truncate">{name}</p>
        {description ? (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
            {description}
          </p>
        ) : null}
        <div className="flex items-center justify-between mt-2">
          <span className="text-base font-bold text-indigo-400">
            {formatCurrency(price, currency)}
          </span>
          <div className="flex items-center gap-1">
            <Tag size={12} className="text-gray-500" />
            <span className="text-[11px] text-gray-500">Product</span>
          </div>
        </div>
        {storeUrl ? (
          <a
            href={String(storeUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg py-2 transition-colors"
          >
            View Product
            <ExternalLink size={12} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ── Order Update Card ────────────────────────────────────────

function OrderCard({ rc }: { rc: Record<string, unknown> }) {
  const orderId = String(rc.order_id || "").slice(-8);
  const status = String(rc.status || rc.order_status || "processing");
  const total = Number(rc.total || rc.amount || 0);
  const currency = String(rc.currency || "SLE");
  const items = Array.isArray(rc.items) ? (rc.items as Array<Record<string, unknown>>) : [];
  const storeName = rc.store_name ? String(rc.store_name) : null;

  const statusMap: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    pending: { icon: <Clock size={14} />, color: "text-amber-400", label: "Pending" },
    processing: { icon: <Package size={14} />, color: "text-blue-400", label: "Processing" },
    shipped: { icon: <Truck size={14} />, color: "text-indigo-400", label: "Shipped" },
    delivered: { icon: <CheckCircle2 size={14} />, color: "text-emerald-400", label: "Delivered" },
    cancelled: { icon: <Clock size={14} />, color: "text-red-400", label: "Cancelled" },
  };

  const s = statusMap[status] || statusMap.processing;

  return (
    <div className="w-[280px] rounded-2xl border border-gray-700/50 bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center">
            <Package size={16} className="text-blue-400" />
          </div>
          <div>
            <p className="text-xs font-medium text-white">Order Update</p>
            {orderId ? (
              <p className="text-[10px] text-gray-500">#{orderId}</p>
            ) : null}
          </div>
        </div>
        <span className={`flex items-center gap-1 text-[11px] font-medium ${s.color}`}>
          {s.icon}
          {s.label}
        </span>
      </div>

      {storeName ? (
        <p className="text-xs text-gray-400 mb-2">From {storeName}</p>
      ) : null}

      {items.length > 0 ? (
        <div className="space-y-1.5 mb-3 border-t border-gray-700/50 pt-2">
          {items.slice(0, 3).map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-gray-300 truncate flex-1 mr-2">
                {String(item.name || item.product_name || "Item")}
                {item.quantity ? ` x${item.quantity}` : ""}
              </span>
              <span className="text-gray-400 shrink-0">
                {formatCurrency(Number(item.price || item.amount || 0), currency)}
              </span>
            </div>
          ))}
          {items.length > 3 ? (
            <p className="text-[11px] text-gray-500">+{items.length - 3} more items</p>
          ) : null}
        </div>
      ) : null}

      {total > 0 ? (
        <div className="flex items-center justify-between border-t border-gray-700/50 pt-2">
          <span className="text-xs text-gray-400">Total</span>
          <span className="text-sm font-bold text-white">
            {formatCurrency(total, currency)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── Shipping Update Card ─────────────────────────────────────

function ShippingCard({ rc, content }: { rc: Record<string, unknown>; content: string | null }) {
  const trackingNumber = rc.tracking_number ? String(rc.tracking_number) : null;
  const carrier = rc.carrier ? String(rc.carrier) : null;
  const status = String(rc.status || "in_transit");
  const eta = rc.eta || rc.estimated_delivery ? String(rc.eta || rc.estimated_delivery) : null;
  const location = rc.current_location ? String(rc.current_location) : null;

  const statusMap: Record<string, { color: string; label: string }> = {
    preparing: { color: "text-amber-400", label: "Preparing" },
    picked_up: { color: "text-blue-400", label: "Picked Up" },
    in_transit: { color: "text-indigo-400", label: "In Transit" },
    out_for_delivery: { color: "text-violet-400", label: "Out for Delivery" },
    delivered: { color: "text-emerald-400", label: "Delivered" },
  };

  const s = statusMap[status] || statusMap.in_transit;

  return (
    <div className="w-[260px] rounded-2xl border border-gray-700/50 bg-gradient-to-br from-gray-800 to-gray-800/80 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-indigo-500/15 flex items-center justify-center">
          <Truck size={16} className="text-indigo-400" />
        </div>
        <div>
          <p className="text-xs font-medium text-white">Shipping Update</p>
          <span className={`text-[11px] font-medium ${s.color}`}>{s.label}</span>
        </div>
      </div>

      {content ? (
        <p className="text-sm text-gray-300 mb-3">{content}</p>
      ) : null}

      <div className="space-y-2 text-xs">
        {trackingNumber ? (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Tracking</span>
            <span className="text-white font-mono">{trackingNumber}</span>
          </div>
        ) : null}
        {carrier ? (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Carrier</span>
            <span className="text-gray-300">{carrier}</span>
          </div>
        ) : null}
        {location ? (
          <div className="flex items-center gap-1 text-gray-400">
            <MapPin size={12} />
            <span>{location}</span>
          </div>
        ) : null}
        {eta ? (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">ETA</span>
            <span className="text-gray-300">{eta}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Payment Link Card ────────────────────────────────────────

function PaymentLinkCard({ rc, content }: { rc: Record<string, unknown>; content: string | null }) {
  const amount = Number(rc.amount || 0);
  const currency = String(rc.currency || "SLE");
  const url = rc.url || rc.payment_url;
  const description = content || rc.description;

  return (
    <div className="w-[260px] rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-600/15 to-emerald-700/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <ExternalLink size={16} className="text-emerald-400" />
        </div>
        <p className="text-xs font-medium text-gray-300">Payment Link</p>
      </div>

      {amount > 0 ? (
        <p className="text-xl font-bold text-white mb-1">
          {formatCurrency(amount, currency)}
        </p>
      ) : null}

      {description ? (
        <p className="text-sm text-gray-300 mb-3">{String(description)}</p>
      ) : null}

      {url ? (
        <a
          href={String(url)}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg py-2 transition-colors"
        >
          Pay Now
          <ExternalLink size={14} />
        </a>
      ) : null}
    </div>
  );
}
