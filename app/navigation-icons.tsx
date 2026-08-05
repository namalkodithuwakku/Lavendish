import type { ReactNode } from "react";

const props={width:19,height:19,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round" as const,strokeLinejoin:"round" as const,"aria-hidden":true};

export type NavigationIconName="hotel"|"group"|"overview"|"ota"|"yield"|"marketing"|"properties"|"reputation"|"reports"|"settings"|"admin"|"more";

export function NavigationIcon({name}:{name:NavigationIconName}):ReactNode{
 const paths:Record<NavigationIconName,ReactNode>={
  hotel:<><path d="M4 20V7.5A1.5 1.5 0 0 1 5.5 6h8A1.5 1.5 0 0 1 15 7.5V20"/><path d="M15 11h3.5a1.5 1.5 0 0 1 1.5 1.5V20M2 20h20M8 10h3M8 14h3"/></>,
  group:<><rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="7" height="7" rx="2"/><rect x="3" y="15" width="7" height="6" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/></>,
  overview:<><path d="M4 13h6V4H4v9ZM14 20h6v-9h-6v9ZM4 20h6v-3H4v3ZM14 7h6V4h-6v3Z"/></>,
  ota:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  yield:<><path d="M4 18 10 12l4 3 6-8"/><path d="M15 7h5v5"/></>,
  marketing:<><path d="m4 13 11-5v10L4 13Z"/><path d="M15 11.2a3 3 0 0 0 0 3.6M6 14l1 5h3l-1-4"/></>,
  properties:<><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20"/><path d="M8 7h4M8 11h4M8 15h4"/></>,
  reputation:<><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></>,
  reports:<><path d="M5 20V10M12 20V4M19 20v-7"/><path d="M2 20h20"/></>,
  settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  admin:<><circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0M19 5h3M20.5 3.5v3"/></>,
  more:<><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>
 };
 return <svg {...props}>{paths[name]}</svg>;
}

export const masterNavigation=[
 {href:"/intelligence",label:"Overview",icon:"overview" as const},
 {href:"/intelligence/ota",label:"OTA",icon:"ota" as const},
 {href:"/intelligence/yield",label:"Yield",icon:"yield" as const},
 {href:"/intelligence/marketing",label:"Marketing",icon:"marketing" as const},
 {href:"/properties",label:"Properties",icon:"properties" as const},
 {href:"/reputation",label:"Reputation",icon:"reputation" as const},
 {href:"/reports",label:"Reports",icon:"reports" as const},
 {href:"/settings/intelligence",label:"Settings",icon:"settings" as const},
];
