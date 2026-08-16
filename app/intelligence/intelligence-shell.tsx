"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { useAuth } from "../auth-provider";
import { masterNavigation, NavigationIcon, type NavigationIconName } from "../navigation-icons";
import { firstAllowedPage, hasPageAccess, pageCodeForHref } from "../page-access";
import "./intelligence.css";
import "./mobile-super-app.css";

const menu=[
 {href:"/",label:"Hotel Occupancy",icon:"hotel" as NavigationIconName,section:"OCCUPANCY"},
 {href:"/group-overview",label:"Group Occupancy",icon:"group" as NavigationIconName,section:"OCCUPANCY"},
 ...masterNavigation.map(item=>({...item,section:["/intelligence/ota","/intelligence/yield","/intelligence/comp-set","/intelligence/marketing"].includes(item.href)?"PERFORMANCE":"MANAGEMENT"})),
];

function isActive(pathname:string,href:string){if(href==="/settings/intelligence")return pathname.startsWith("/settings/");return href==="/"?pathname==="/":pathname.startsWith(href)}

export function IntelligenceShell({eyebrow,title,actions,children}:{eyebrow:string;title:string;actions?:ReactNode;children:ReactNode}){
  const pathname=usePathname();
  const {access,session}=useAuth();
  const [moreOpen,setMoreOpen]=useState(false);
  if(!session||!access)return <main className="intel-access"><section><span>NK</span><h1>Checking secure access</h1><p>Please wait while your access is confirmed.</p></section></main>;
  const allowedMenu=menu.filter(item=>{const code=pageCodeForHref(item.href);return code&&hasPageAccess(access.page_codes,code)});
  const menuWithSections=allowedMenu.map((item,index)=>({...item,showSection:index===0||allowedMenu[index-1].section!==item.section}));
  const allowedMore=masterNavigation.filter(item=>{const code=pageCodeForHref(item.href);return code&&hasPageAccess(access.page_codes,code)&&!["/intelligence/ota","/intelligence/yield"].includes(item.href)});
  return <main className="intel-app">
    <aside className="intel-rail">
      <Link className="intel-brand" href={firstAllowedPage(access.page_codes)}><span>NKH</span><div><b>Performance Hub</b><small>Hotel Operations Platform</small></div></Link>
      <nav className="intel-menu" aria-label="Main navigation">{menuWithSections.map(item=><span key={item.href}>{item.showSection&&<small className="intel-menu-label">{item.section}</small>}<Link className={isActive(pathname,item.href)?"active":""} href={item.href} title={item.label}><span><NavigationIcon name={item.icon}/></span><b>{item.label}</b></Link></span>)}</nav>
      <div className="intel-master"><span>NK</span><div><b>{access.role==="MASTER_ADMIN"?"Master Control":"Authorized Access"}</b><small>{access.page_codes.includes("ALL")?"All modules enabled":`${access.page_codes.length} pages enabled`}</small></div></div>
    </aside>
    <section className="intel-main"><header className="intel-topbar"><div><p>{eyebrow}</p><h1>{title}</h1></div><div>{actions}</div></header>{children}</section>
    {moreOpen&&<button className="mobile-more-backdrop" aria-label="Close more menu" onClick={()=>setMoreOpen(false)}/>} 
    {allowedMore.length>0&&<section className={`mobile-more-sheet ${moreOpen?"open":""}`} aria-hidden={!moreOpen}><header><div><small>NKH PERFORMANCE HUB</small><h2>More</h2></div><button onClick={()=>setMoreOpen(false)} aria-label="Close more menu">×</button></header><div>{allowedMore.map(item=><Link className={isActive(pathname,item.href)?"active":""} href={item.href} key={item.href} onClick={()=>setMoreOpen(false)}><span><NavigationIcon name={item.icon}/></span><div><b>{item.label}</b><small>{item.href==="/intelligence/comp-set"?"Live competitor rate movements":item.href==="/intelligence/marketing"?"Demand opportunities":item.href==="/properties"?"Hotel profiles and sources":item.href==="/reputation"?"Reviews and responses":item.href==="/reports"?"Management reporting":"Users, schedules and access"}</small></div></Link>)}</div></section>}
    <nav className="intel-mobile-nav" aria-label="Mobile app navigation">{allowedMenu.filter(item=>["/","/group-overview","/intelligence/ota","/intelligence/yield"].includes(item.href)).map(item=><Link className={isActive(pathname,item.href)?"active":""} href={item.href} key={item.href}><span><NavigationIcon name={item.icon}/></span><b>{item.label.replace(" Occupancy","")}</b></Link>)}{allowedMore.length>0&&<button className={moreOpen||!["/","/group-overview","/intelligence/ota","/intelligence/yield"].some(href=>isActive(pathname,href))?"active":""} onClick={()=>setMoreOpen(open=>!open)}><span><NavigationIcon name="more"/></span><b>More</b></button>}</nav>
  </main>
}
