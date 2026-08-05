"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "./auth-provider";

type NavItem = { href: string; label: string; icon: ReactNode; active: (path: string) => boolean };

const iconProps = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const hotelIcon = <svg {...iconProps}><path d="M4 20V7.5A1.5 1.5 0 0 1 5.5 6h8A1.5 1.5 0 0 1 15 7.5V20"/><path d="M15 11h3.5a1.5 1.5 0 0 1 1.5 1.5V20M2 20h20M8 10h3M8 14h3"/></svg>;
const groupIcon = <svg {...iconProps}><rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="7" height="7" rx="2"/><rect x="3" y="15" width="7" height="6" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/></svg>;
const otaIcon = <svg {...iconProps}><path d="M12 3 3.8 6.5v5.3c0 4.7 3.2 7.8 8.2 9.2 5-1.4 8.2-4.5 8.2-9.2V6.5L12 3Z"/><path d="m8.7 12 2.1 2.1 4.6-4.6"/></svg>;
const yieldIcon = <svg {...iconProps}><path d="M4 18V9M10 18V5M16 18v-6M22 18V3"/><path d="m3 14 7-5 6 2 6-6"/></svg>;
const adminIcon = <svg {...iconProps}><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 6.5h2M20 5.5v2"/></svg>;

export function MobileBottomNav() {
  const pathname = usePathname();
  const { access, session } = useAuth();
  if (!session || !access || pathname === "/login") return null;

  const fullPortfolio = access.hotel_codes.includes("ALL");
  const master = access.role === "MASTER_ADMIN";
  const items: NavItem[] = [
    { href: "/", label: "Hotel", icon: hotelIcon, active: (path) => path === "/" },
    ...(fullPortfolio ? [{ href: "/group-overview", label: "Group", icon: groupIcon, active: (path: string) => path.startsWith("/group-overview") }] : []),
    ...(master ? [
      { href: "/alerts/ota", label: "OTA", icon: otaIcon, active: (path: string) => path.startsWith("/alerts/ota") },
      { href: "/alerts/yield", label: "Yield", icon: yieldIcon, active: (path: string) => path.startsWith("/alerts/yield") },
      { href: "/admin", label: "Admin", icon: adminIcon, active: (path: string) => path.startsWith("/admin") },
    ] : []),
  ];

  return <nav className="mobile-bottom-nav" aria-label="App navigation">
    {items.map((item) => <Link className={item.active(pathname) ? "active" : ""} href={item.href} key={item.href}><span>{item.icon}</span><b>{item.label}</b></Link>)}
  </nav>;
}
