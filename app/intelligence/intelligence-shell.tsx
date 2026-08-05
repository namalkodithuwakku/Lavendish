"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "../auth-provider";
import "./intelligence.css";

const menu = [
  {href:"/",label:"Hotel Occupancy",icon:"HV",section:"OCCUPANCY"},
  {href:"/group-overview",label:"Group Occupancy",icon:"GO",section:"OCCUPANCY"},
  {href:"/intelligence",label:"Overview",icon:"OV",section:"INTELLIGENCE"},
  {href:"/intelligence/ota",label:"OTA",icon:"OT",section:"INTELLIGENCE"},
  {href:"/intelligence/yield",label:"Yield",icon:"YL",section:"INTELLIGENCE"},
  {href:"/intelligence/marketing",label:"Marketing",icon:"MK",section:"INTELLIGENCE"},
  {href:"/properties",label:"Properties",icon:"PR",section:"MANAGEMENT"},
  {href:"/reputation",label:"Reputation",icon:"RP",section:"MANAGEMENT"},
  {href:"/reports",label:"Reports",icon:"RT",section:"MANAGEMENT"},
  {href:"/settings/intelligence",label:"Settings",icon:"ST",section:"MANAGEMENT"},
];

function isActive(pathname:string,href:string){return href==="/intelligence"?pathname==="/intelligence":href==="/"?pathname==="/":pathname.startsWith(href)}

export function IntelligenceShell({eyebrow,title,actions,children}:{eyebrow:string;title:string;actions?:ReactNode;children:ReactNode}){
  const pathname=usePathname();
  const {access,session}=useAuth();
  if(!session||!access)return <main className="intel-access"><section><span>NK</span><h1>Checking secure access</h1><p>Please wait while your access is confirmed.</p></section></main>;
  if(access.role!=="MASTER_ADMIN")return <main className="intel-access"><section><span>!</span><h1>Master access required</h1><p>The new intelligence modules are currently available only to the Master Admin. Your Hotel and Group Occupancy access is unchanged.</p><Link href="/">Return to occupancy</Link></section></main>;
  const menuWithSections=menu.map((item,index)=>({...item,showSection:index===0||menu[index-1].section!==item.section}));
  return <main className="intel-app">
    <aside className="intel-rail">
      <Link className="intel-brand" href="/intelligence"><span>NKH</span><div><b>Occupancy Intelligence</b><small>Lavendish Leisure</small></div></Link>
      <nav className="intel-menu" aria-label="Intelligence navigation">{menuWithSections.map(item=><span key={item.href}>{item.showSection&&<small className="intel-menu-label">{item.section}</small>}<Link className={isActive(pathname,item.href)?"active":""} href={item.href} title={item.label}><span>{item.icon}</span><b>{item.label}</b></Link></span>)}</nav>
      <div className="intel-master"><span>NK</span><div><b>Master Control</b><small>All modules enabled</small></div></div>
    </aside>
    <section className="intel-main"><header className="intel-topbar"><div><p>{eyebrow}</p><h1>{title}</h1></div><div>{actions}</div></header>{children}</section>
    <nav className="intel-mobile-nav" aria-label="Mobile intelligence navigation">{menu.filter(item=>["/","/intelligence","/intelligence/ota","/intelligence/yield","/intelligence/marketing"].includes(item.href)).map(item=><Link className={isActive(pathname,item.href)?"active":""} href={item.href} key={item.href}><span>{item.icon}</span><b>{item.label.replace(" Occupancy","")}</b></Link>)}</nav>
  </main>
}
