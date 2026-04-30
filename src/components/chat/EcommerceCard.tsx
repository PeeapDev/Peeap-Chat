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
  Receipt,
  CreditCard,
  Wallet,
  Smartphone,
  XCircle,
  Download,
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
    // Receipt vs status update — differentiate by category in rich_content
    if (rc.category === "order_created") {
      return <OrderReceiptCard rc={rc} content={message.content} />;
    }
    return <OrderStatusCard rc={rc} content={message.content} />;
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

// ── Order Receipt Card ───────────────────────────────────────

function OrderReceiptCard({ rc, content }: { rc: Record<string, unknown>; content: string | null }) {
  const orderNumber = String(rc.order_number || rc.order_id || "");
  const storeName = String(rc.store_name || "Store");
  const receiptPdfUrl = rc.receipt_pdf_url ? String(rc.receipt_pdf_url) : null;
  const items = Array.isArray(rc.items) ? (rc.items as Array<Record<string, unknown>>) : [];
  const subtotal = Number(rc.subtotal || 0);
  const taxAmount = Number(rc.tax_amount || 0);
  const deliveryFee = Number(rc.delivery_fee || 0);
  const totalAmount = Number(rc.total_amount || rc.total || subtotal + taxAmount + deliveryFee);
  const paymentMethod = String(rc.payment_method || "");
  const orderType = String(rc.order_type || "online");
  const deliveryAddress = rc.delivery_address ? String(rc.delivery_address) : null;

  const paymentLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    peeap_checkout: { label: "Peeap Checkout", icon: <Wallet size={12} /> },
    wallet: { label: "Wallet", icon: <Wallet size={12} /> },
    mobile_money: { label: "Mobile Money", icon: <Smartphone size={12} /> },
    card: { label: "Card", icon: <CreditCard size={12} /> },
  };
  const payment = paymentLabels[paymentMethod] || { label: paymentMethod.replace(/_/g, " "), icon: <CreditCard size={12} /> };

  return (
    <div className="w-[300px] rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-gray-800 to-gray-800/90 overflow-hidden">
      {/* Header */}
      <div className="bg-emerald-500/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Receipt size={18} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Order Receipt</p>
            <p className="text-[11px] text-emerald-400 font-mono">{orderNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold px-2 py-1 rounded-full">
          <CheckCircle2 size={10} />
          Confirmed
        </div>
      </div>

      <div className="px-4 py-3">
        {/* Warm message from seller */}
        {content && (
          <p className="text-[13px] text-gray-300 leading-relaxed mb-3">{content}</p>
        )}

        {/* Store name */}
        <div className="flex items-center gap-1.5 mb-3">
          <ShoppingBag size={12} className="text-gray-500" />
          <span className="text-xs text-gray-400">{storeName}</span>
        </div>

        {/* Items */}
        {items.length > 0 && (
          <div className="space-y-2 mb-3">
            {items.map((item, i) => {
              const qty = Number(item.quantity || 1);
              const name = String(item.product_name || item.name || "Item");
              const itemTotal = Number(item.total_price || item.price || 0);
              return (
                <div key={i} className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 leading-tight">{name}</p>
                    <p className="text-[11px] text-gray-500">
                      Qty: {qty} × NLe {Number(item.unit_price || itemTotal / qty || 0).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-sm text-gray-300 font-medium shrink-0">
                    NLe {itemTotal.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Totals */}
        <div className="border-t border-gray-700/50 pt-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Subtotal</span>
            <span className="text-gray-400">NLe {subtotal.toLocaleString()}</span>
          </div>
          {taxAmount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Tax</span>
              <span className="text-gray-400">NLe {taxAmount.toLocaleString()}</span>
            </div>
          )}
          {deliveryFee > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Delivery</span>
              <span className="text-gray-400">NLe {deliveryFee.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-1 border-t border-gray-700/30">
            <span className="text-xs font-medium text-gray-300">Total</span>
            <span className="text-base font-bold text-white">NLe {totalAmount.toLocaleString()}</span>
          </div>
        </div>

        {/* Footer: payment + delivery */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
            {payment.icon}
            <span>{payment.label}</span>
          </div>
          {orderType === "delivery" && (
            <div className="flex items-center gap-1 text-[11px] text-gray-500">
              <Truck size={11} />
              <span>Delivery</span>
            </div>
          )}
          {orderType === "pickup" && (
            <div className="flex items-center gap-1 text-[11px] text-gray-500">
              <Package size={11} />
              <span>Pickup</span>
            </div>
          )}
        </div>

        {deliveryAddress && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-gray-500">
            <MapPin size={11} className="shrink-0 mt-0.5" />
            <span>{deliveryAddress}</span>
          </div>
        )}

        {/* Download Receipt PDF */}
        {receiptPdfUrl && (
          <a
            href={receiptPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 w-full flex items-center justify-center gap-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-medium rounded-lg py-2 transition-colors"
          >
            <Download size={13} />
            Download Receipt
          </a>
        )}
      </div>
    </div>
  );
}

// ── Order Status Update Card ────────────────────────────────

function OrderStatusCard({ rc, content }: { rc: Record<string, unknown>; content: string | null }) {
  const orderNumber = String(rc.order_number || rc.order_id || "");
  const status = String(rc.new_status || rc.status || rc.order_status || "processing");
  const totalAmount = Number(rc.total_amount || rc.total || rc.amount || 0);
  const storeName = rc.store_name ? String(rc.store_name) : null;

  const statusMap: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string; label: string }> = {
    pending: { icon: <Clock size={14} />, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending" },
    paid: { icon: <CheckCircle2 size={14} />, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Payment Confirmed" },
    processing: { icon: <Package size={14} />, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Preparing Order" },
    shipped: { icon: <Truck size={14} />, color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "Shipped" },
    delivered: { icon: <CheckCircle2 size={14} />, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Delivered" },
    cancelled: { icon: <XCircle size={14} />, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Cancelled" },
  };

  const s = statusMap[status] || statusMap.processing;

  return (
    <div className={`w-[280px] rounded-2xl border ${s.border} ${s.bg} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full ${s.bg} flex items-center justify-center ${s.color}`}>
            {s.icon}
          </div>
          <div>
            <p className="text-xs font-medium text-white">{s.label}</p>
            <p className="text-[10px] text-gray-500 font-mono">{orderNumber}</p>
          </div>
        </div>
      </div>

      {content && (
        <p className="text-sm text-gray-300 mt-2 leading-relaxed">{content}</p>
      )}

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-700/30">
        {storeName && (
          <span className="text-[11px] text-gray-500">{storeName}</span>
        )}
        {totalAmount > 0 && (
          <span className="text-sm font-bold text-white">NLe {totalAmount.toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}

// ── Shipping Update Card ─────────────────────────────────────

function ShippingCard({ rc, content }: { rc: Record<string, unknown>; content: string | null }) {
  const trackingNumber = rc.tracking_number || rc.job_number ? String(rc.tracking_number || rc.job_number) : null;
  const carrier = rc.carrier ? String(rc.carrier) : null;
  const driverName = rc.driver_name ? String(rc.driver_name) : null;
  const status = String(rc.new_status || rc.status || "in_transit");
  const eta = rc.eta || rc.estimated_delivery ? String(rc.eta || rc.estimated_delivery) : null;
  const location = rc.current_location ? String(rc.current_location) : null;
  const deliveryAddress = rc.delivery_address ? String(rc.delivery_address) : null;
  const storeName = rc.store_name ? String(rc.store_name) : null;

  const statusMap: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string; label: string }> = {
    pending: { icon: <Clock size={14} />, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Pending" },
    assigned: { icon: <Package size={14} />, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Driver Assigned" },
    picked_up: { icon: <Package size={14} />, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", label: "Picked Up" },
    in_transit: { icon: <Truck size={14} />, color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20", label: "In Transit" },
    out_for_delivery: { icon: <Truck size={14} />, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", label: "Out for Delivery" },
    delivered: { icon: <CheckCircle2 size={14} />, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Delivered" },
    completed: { icon: <CheckCircle2 size={14} />, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Completed" },
    cancelled: { icon: <XCircle size={14} />, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Cancelled" },
    failed: { icon: <XCircle size={14} />, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Failed" },
  };

  const s = statusMap[status] || statusMap.in_transit;

  return (
    <div className={`w-[280px] rounded-2xl border ${s.border} bg-gradient-to-br from-gray-800 to-gray-800/90 p-4`}>
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center ${s.color}`}>
          {s.icon}
        </div>
        <div>
          <p className="text-xs font-medium text-white">Delivery Update</p>
          <span className={`text-[11px] font-semibold ${s.color}`}>{s.label}</span>
        </div>
      </div>

      {content && (
        <p className="text-sm text-gray-300 mb-3 leading-relaxed">{content}</p>
      )}

      <div className="space-y-2 text-xs">
        {driverName && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Driver</span>
            <span className="text-gray-300">{driverName}</span>
          </div>
        )}
        {trackingNumber && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Tracking</span>
            <span className="text-white font-mono text-[11px]">{trackingNumber}</span>
          </div>
        )}
        {carrier && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Carrier</span>
            <span className="text-gray-300">{carrier}</span>
          </div>
        )}
        {deliveryAddress && (
          <div className="flex items-start gap-1.5 text-gray-400 mt-1">
            <MapPin size={12} className="shrink-0 mt-0.5" />
            <span>{deliveryAddress}</span>
          </div>
        )}
        {location && (
          <div className="flex items-center gap-1 text-gray-400">
            <MapPin size={12} />
            <span>{location}</span>
          </div>
        )}
        {eta && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500">ETA</span>
            <span className="text-gray-300">{eta}</span>
          </div>
        )}
        {storeName && (
          <div className="pt-1.5 border-t border-gray-700/30 flex items-center gap-1.5 text-gray-500">
            <ShoppingBag size={11} />
            <span>{storeName}</span>
          </div>
        )}
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
