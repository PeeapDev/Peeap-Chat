"use client";

import { getInitials, getAvatarColor } from "@/lib/utils";

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  id?: string;
  size?: "sm" | "md" | "lg";
  online?: boolean;
}

const sizes = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

export default function Avatar({
  src,
  name,
  id = "",
  size = "md",
  online,
}: AvatarProps) {
  const safeName = name || "?";
  const colorClass = getAvatarColor(id || safeName);
  const sizeClass = sizes[size];

  return (
    <div className="relative shrink-0">
      {src ? (
        <img
          src={src}
          alt={safeName}
          className={`${sizeClass} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${sizeClass} ${colorClass} rounded-full flex items-center justify-center text-white font-medium`}
        >
          {getInitials(safeName) || "?"}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-gray-900 ${
            online ? "bg-emerald-500" : "bg-gray-500"
          }`}
        />
      )}
    </div>
  );
}
