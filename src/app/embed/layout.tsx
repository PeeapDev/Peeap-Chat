import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Peeap Chat - Embed",
  description: "Embeddable public chat powered by Peeap",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
