"use client";

import { useState } from "react";
import { useChatContext } from "@/components/ChatProvider";
import { Lock, ShieldCheck, X } from "lucide-react";

export default function E2EESetupModal() {
  const { e2eeStatus, setupE2EE, restoreE2EE, skipE2EE } = useChatContext();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mode =
    e2eeStatus === "needs_setup"
      ? "setup"
      : e2eeStatus === "needs_restore"
      ? "restore"
      : null;

  if (!mode) return null;

  async function handleSubmit() {
    setErr(null);
    if (mode === "setup") {
      if (password.length < 8) {
        setErr("Use at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setErr("Passwords don't match.");
        return;
      }
    } else if (!password) {
      setErr("Enter your recovery password.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "setup") await setupE2EE(password);
      else await restoreE2EE(password);
      setPassword("");
      setConfirm("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-800 shadow-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center">
              {mode === "setup" ? (
                <ShieldCheck size={20} className="text-indigo-400" />
              ) : (
                <Lock size={20} className="text-indigo-400" />
              )}
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">
                {mode === "setup" ? "Set up encryption" : "Unlock your messages"}
              </h2>
              <p className="text-[11px] text-gray-500">
                End-to-end encrypted chats
              </p>
            </div>
          </div>
          <button
            onClick={skipE2EE}
            className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800"
            aria-label="Skip"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          {mode === "setup"
            ? "Choose a recovery password. It encrypts your private key so you can restore your chats on a new device. We can't reset it — if you forget it, your encrypted history is lost."
            : "Enter the recovery password you set, to decrypt your chats on this device."}
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Recovery password"
          autoFocus
          className="w-full mb-2 px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        {mode === "setup" && (
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className="w-full mb-2 px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        )}

        {err && <p className="text-[12px] text-red-400 mb-2">{err}</p>}

        <button
          onClick={handleSubmit}
          disabled={busy}
          className="w-full mt-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium transition-colors"
        >
          {busy
            ? "Working…"
            : mode === "setup"
            ? "Enable encryption"
            : "Unlock"}
        </button>
        <button
          onClick={skipE2EE}
          disabled={busy}
          className="w-full mt-2 px-4 py-2 text-gray-400 hover:text-gray-200 text-[13px]"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
