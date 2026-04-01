"use client";

import {
  ArrowUpRight,
  ArrowDownLeft,
  Receipt,
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Message } from "@/lib/types";

interface PaymentCardProps {
  message: Message;
  isOwn: boolean;
}

export default function PaymentCard({ message, isOwn }: PaymentCardProps) {
  const rc = (message.rich_content || message.metadata || {}) as Record<string, unknown>;
  const amount = Number(rc.amount || 0);
  const currency = String(rc.currency || "SLE");
  const status = String(rc.status || "pending");
  const notes = String(rc.notes || message.content || "");
  const type = message.message_type;

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    pending: {
      icon: <Clock size={14} />,
      label: "Pending",
      color: "text-amber-400",
    },
    completed: {
      icon: <CheckCircle2 size={14} />,
      label: "Completed",
      color: "text-emerald-400",
    },
    declined: {
      icon: <XCircle size={14} />,
      label: "Declined",
      color: "text-red-400",
    },
    expired: {
      icon: <XCircle size={14} />,
      label: "Expired",
      color: "text-gray-400",
    },
    cancelled: {
      icon: <XCircle size={14} />,
      label: "Cancelled",
      color: "text-gray-400",
    },
  };

  const typeConfig: Record<string, { icon: React.ReactNode; label: string; bgColor: string }> = {
    payment_request: {
      icon: <ArrowDownLeft size={18} />,
      label: "Payment Request",
      bgColor: "from-amber-600/20 to-amber-700/10 border-amber-500/30",
    },
    payment_confirmation: {
      icon: <CheckCircle2 size={18} />,
      label: "Payment Sent",
      bgColor: "from-emerald-600/20 to-emerald-700/10 border-emerald-500/30",
    },
    invoice: {
      icon: <FileText size={18} />,
      label: "Invoice",
      bgColor: "from-blue-600/20 to-blue-700/10 border-blue-500/30",
    },
    receipt: {
      icon: <Receipt size={18} />,
      label: "Receipt",
      bgColor: "from-violet-600/20 to-violet-700/10 border-violet-500/30",
    },
    fee_notice: {
      icon: <FileText size={18} />,
      label: "Fee Notice",
      bgColor: "from-rose-600/20 to-rose-700/10 border-rose-500/30",
    },
    salary_slip: {
      icon: <ArrowUpRight size={18} />,
      label: "Salary Slip",
      bgColor: "from-teal-600/20 to-teal-700/10 border-teal-500/30",
    },
  };

  const tConfig = typeConfig[type] || typeConfig.payment_request;
  const sConfig = statusConfig[status] || statusConfig.pending;

  return (
    <div
      className={`w-[280px] rounded-2xl border bg-gradient-to-br ${tConfig.bgColor} p-4`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white">
          {tConfig.icon}
        </div>
        <div>
          <p className="text-xs text-gray-300 font-medium">{tConfig.label}</p>
          <div className={`flex items-center gap-1 text-[11px] ${sConfig.color}`}>
            {sConfig.icon}
            <span>{sConfig.label}</span>
          </div>
        </div>
      </div>

      {/* Amount */}
      {amount > 0 ? (
        <div className="mb-2">
          <p className="text-2xl font-bold text-white">
            {formatCurrency(amount, currency)}
          </p>
        </div>
      ) : null}

      {/* Notes */}
      {notes ? (
        <p className="text-sm text-gray-300 mb-3">{notes}</p>
      ) : null}

      {/* Invoice items */}
      {rc.invoice_data ? (
        <div className="space-y-1 mb-3 border-t border-white/10 pt-2">
          {Array.isArray((rc.invoice_data as Record<string, string>)?.items)
            ? ((rc.invoice_data as { items: Array<Record<string, string | number>> }).items).map(
                (item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs text-gray-300"
                  >
                    <span>{String(item.name || item.description || "")}</span>
                    <span>{formatCurrency(Number(item.amount || 0), currency)}</span>
                  </div>
                )
              )
            : null}
        </div>
      ) : null}

      {/* Action button for pending requests */}
      {status === "pending" && !isOwn && type === "payment_request" && (
        <button className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg py-2 mt-1 transition-colors">
          Pay Now
        </button>
      )}
    </div>
  );
}
