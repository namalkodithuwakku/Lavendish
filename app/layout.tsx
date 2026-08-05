import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./readability.css";
import "./mobile-app.css";
import "./alert-links.css";
import { AuthProvider } from "./auth-provider";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { PwaClient } from "./pwa-client";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Lavendish Occupancy", template: "%s | Lavendish Occupancy" },
  applicationName: "Lavendish Occupancy",
  description: "Live occupancy intelligence for hotel group leadership.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Lavendish Occupancy",
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}<MobileBottomNav /></AuthProvider>
        <PwaClient />
      </body>
    </html>
  );
}
