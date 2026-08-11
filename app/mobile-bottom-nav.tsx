"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { useAuth } from "./auth-provider";
import { masterNavigation, NavigationIcon } from "./navigation-icons";

type NavItem = { href: string; label: string; icon: ReactNode; active: (path: string) => boolean };

const iconProps = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const hotelIcon = <svg {...iconProps}><path d="M4 20V7.5A1.5 1.5 0 0 1 5.5 6h8A1.5 1.5 0 0 1 15 7.5V20"/><path d="M15 11h3.5a1.5 1.5 0 0 1 1.5 1.5V20M2 20h20M8 10h3M8 14h3"/></svg>;
const groupIcon = <svg {...iconProps}><rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="7" height="7" rx="2"/><rect x="3" y="15" width="7" height="6" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/></svg>;
function isActive(pathname:string,href:string){return href==="/"?pathname==="/":pathname.startsWith(href)}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { access, session } = useAuth();
  const [moreOpen,setMoreOpen] = useState(false);
  const intelligenceArea=pathname.startsWith("/intelligence")||pathname.startsWith("/properties")||pathname.startsWith("/reputation")||pathname.startsWith("/reports")||pathname.startsWith("/settings/");
  if (!session || !access || pathname === "/login" || intelligenceArea) return null;

  const fullPortfolio = access.hotel_codes.includes("ALL");
  const master = access.role === "MASTER_ADMIN";
  const items: NavItem[] = [
    { href: "/", label: "Hotel", icon: hotelIcon, active: (path) => path === "/" },
    ...(fullPortfolio ? [{ href: "/group-overview", label: "Group", icon: groupIcon, active: (path: string) => path.startsWith("/group-overview") }] : []),
    ...(master ? [
      { href: "/intelligence/ota", label: "OTA", icon: <NavigationIcon name="ota"/>, active: (path: string) => path.startsWith("/intelligence/ota") },
      { href: "/intelligence/yield", label: "Yield", icon: <NavigationIcon name="yield"/>, active: (path: string) => path.startsWith("/intelligence/yield") },
    ] : []),
  ];

  return <>
    {master&&moreOpen&&<button className="mobile-more-backdrop" aria-label="Close more menu" onClick={()=>setMoreOpen(false)}/>}
    {master&&<section className={`mobile-more-sheet ${moreOpen?"open":""}`} aria-hidden={!moreOpen}><header><div><small>NKH PERFORMANCE HUB</small><h2>More</h2></div><button onClick={()=>setMoreOpen(false)} aria-label="Close more menu">×</button></header><div>{masterNavigation.filter(item=>!["/intelligence/ota","/intelligence/yield"].includes(item.href)).map(item=><Link href={item.href} key={item.href} onClick={()=>setMoreOpen(false)}><span><NavigationIcon name={item.icon}/></span><div><b>{item.label}</b><small>{item.href==="/intelligence/marketing"?"Demand opportunities":item.href==="/properties"?"Hotel profiles and sources":item.href==="/reputation"?"Reviews and responses":item.href==="/reports"?"Management reporting":"Users, schedules and access"}</small></div></Link>)}</div></section>}
    <nav className="mobile-bottom-nav" aria-label="App navigation">
      {items.map((item) => <Link className={item.active(pathname) ? "active" : ""} href={item.href} key={item.href}><span>{item.icon}</span><b>{item.label}</b></Link>)}
      {master&&<button className={moreOpen?"active":""} onClick={()=>setMoreOpen(open=>!open)}><span><NavigationIcon name="more"/></span><b>More</b></button>}
    </nav>
  </>;
}
