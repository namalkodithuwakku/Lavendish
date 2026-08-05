import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./readability.css";
import "./mobile-app.css";
import "./alert-links.css";
import "./product-system.css";
import "./intelligence/mobile-super-app.css";
import { AuthProvider } from "./auth-provider";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { PwaClient } from "./pwa-client";

export const metadata: Metadata = {
  title: { default: "NKH Performance Hub", template: "%s | NKH Performance Hub" },
  applicationName: "NKH Performance Hub",
  description: "Hotel performance and revenue operations by N K Hotels.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NKH Performance Hub",
  },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7463a8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}<MobileBottomNav /></AuthProvider>
        <PwaClient />
      </body>
    </html>
  );
}
