"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Smartphone, RefreshCw, Check, Shield, Wifi } from "lucide-react";

interface QRSession {
  session_id: string;
  secret: string;
  expires_at: string;
  qr_image: string; // data:image/png;base64,... from server
}

interface QRLoginScreenProps {
  onAuthenticated: (token: string, userId: string) => void;
}

export default function QRLoginScreen({ onAuthenticated }: QRLoginScreenProps) {
  const [qrSession, setQrSession] = useState<QRSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [scanned, setScanned] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const generateQRSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpired(false);
    setScanned(false);

    try {
      const res = await fetch("/api/auth/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) throw new Error("Failed to generate QR code");

      const data: QRSession = await res.json();
      setQrSession(data);
      startPolling(data.session_id, data.secret, data.expires_at);
    } catch (err) {
      setError("Failed to generate QR code. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    generateQRSession();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [generateQRSession]);


  function startPolling(sessionId: string, secret: string, expiresAt: string) {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      // Check expiry client-side
      if (new Date(expiresAt) < new Date()) {
        setExpired(true);
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }

      try {
        const res = await fetch(
          `/api/auth/qr/status?session_id=${sessionId}&secret=${secret}`
        );
        const data = await res.json();

        if (data.status === "confirmed" && data.token) {
          if (pollRef.current) clearInterval(pollRef.current);
          setScanned(true);

          // No localStorage — token lives only in memory for this session
          setTimeout(() => {
            onAuthenticated(data.token, data.user_id);
          }, 1000);
        } else if (data.status === "expired") {
          setExpired(true);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Silently retry on network errors
      }
    }, 2000); // Poll every 2 seconds
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Peeap Chat</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Send and receive messages from your browser
          </p>
        </div>

        {/* QR Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          {scanned ? (
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4 animate-pulse">
                <Check size={40} className="text-green-400" />
              </div>
              <h3 className="text-white text-lg font-semibold">Logged in!</h3>
              <p className="text-gray-400 text-sm mt-1">Loading your chats...</p>
            </div>
          ) : (
            <>
              {/* QR Code */}
              <div className="flex justify-center mb-6">
                <div className="relative bg-white rounded-xl p-3">
                  {loading ? (
                    <div className="w-[200px] h-[200px] flex items-center justify-center">
                      <RefreshCw size={24} className="text-gray-400 animate-spin" />
                    </div>
                  ) : expired ? (
                    <button
                      onClick={generateQRSession}
                      className="w-[200px] h-[200px] flex flex-col items-center justify-center gap-2 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      <RefreshCw size={28} className="text-gray-500" />
                      <span className="text-gray-500 text-sm font-medium">
                        Click to refresh
                      </span>
                    </button>
                  ) : error ? (
                    <button
                      onClick={generateQRSession}
                      className="w-[200px] h-[200px] flex flex-col items-center justify-center gap-2"
                    >
                      <span className="text-red-500 text-sm text-center">{error}</span>
                      <RefreshCw size={20} className="text-gray-500" />
                    </button>
                  ) : qrSession?.qr_image ? (
                    <img
                      src={qrSession.qr_image}
                      alt="Scan this QR code with your Peeap app"
                      width={200}
                      height={200}
                      className="w-[200px] h-[200px]"
                    />
                  ) : null}
                </div>
              </div>

              {/* Instructions */}
              <div className="space-y-4">
                <h3 className="text-white font-semibold text-center text-lg">
                  Scan to log in
                </h3>
                <ol className="space-y-3 text-sm">
                  <li className="flex items-start gap-3 text-gray-300">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">
                      1
                    </span>
                    Open <strong className="text-white">Peeap</strong> on your phone
                  </li>
                  <li className="flex items-start gap-3 text-gray-300">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">
                      2
                    </span>
                    Tap{" "}
                    <span className="inline-flex items-center gap-1 text-white">
                      <Smartphone size={14} /> Linked Devices
                    </span>{" "}
                    in Settings
                  </li>
                  <li className="flex items-start gap-3 text-gray-300">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold">
                      3
                    </span>
                    Point your phone at this screen to scan the QR code
                  </li>
                </ol>
              </div>
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-6 flex items-center justify-center gap-6 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Shield size={12} /> End-to-end encrypted
          </span>
          <span className="flex items-center gap-1">
            <Wifi size={12} /> Stays in sync
          </span>
        </div>
      </div>
    </div>
  );
}

