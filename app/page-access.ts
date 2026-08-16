export const PAGE_OPTIONS = [
  { code: "HOTEL_OCCUPANCY", label: "Hotel Occupancy", href: "/" },
  { code: "GROUP_OCCUPANCY", label: "Group Occupancy", href: "/group-overview" },
  { code: "OTA_ALERTS", label: "OTA Alerts", href: "/intelligence/ota" },
  { code: "YIELD_ALERTS", label: "Yield Alerts", href: "/intelligence/yield" },
  { code: "COMP_SET", label: "Comp Set", href: "/intelligence/comp-set" },
  { code: "MARKETING", label: "Marketing", href: "/intelligence/marketing" },
  { code: "PROPERTIES", label: "Properties", href: "/properties" },
  { code: "REPUTATION", label: "Reputation", href: "/reputation" },
  { code: "REPORTS", label: "Reports", href: "/reports" },
  { code: "SETTINGS", label: "Settings", href: "/settings/intelligence" },
] as const;

export type PageCode = (typeof PAGE_OPTIONS)[number]["code"];

export function hasPageAccess(pageCodes:string[]|undefined, code:PageCode){
  return Boolean(pageCodes?.includes("ALL") || pageCodes?.includes(code));
}

export function pageCodeForPath(pathname:string):PageCode|null{
  if(pathname==="/")return "HOTEL_OCCUPANCY";
  if(pathname.startsWith("/group-overview"))return "GROUP_OCCUPANCY";
  if(pathname.startsWith("/intelligence/ota")||pathname.startsWith("/alerts/ota"))return "OTA_ALERTS";
  if(pathname.startsWith("/intelligence/yield")||pathname.startsWith("/alerts/yield")||pathname.startsWith("/admin/yield"))return "YIELD_ALERTS";
  if(pathname.startsWith("/intelligence/comp-set"))return "COMP_SET";
  if(pathname.startsWith("/intelligence/marketing"))return "MARKETING";
  if(pathname.startsWith("/properties")||pathname==="/admin")return "PROPERTIES";
  if(pathname.startsWith("/reputation"))return "REPUTATION";
  if(pathname.startsWith("/reports"))return "REPORTS";
  if(pathname.startsWith("/settings/"))return "SETTINGS";
  return null;
}

export function firstAllowedPage(pageCodes:string[]|undefined){
  if(pageCodes?.includes("ALL"))return "/";
  return PAGE_OPTIONS.find(page=>pageCodes?.includes(page.code))?.href ?? "/login";
}

export function pageCodeForHref(href:string){
  return PAGE_OPTIONS.find(page=>page.href===href)?.code;
}
