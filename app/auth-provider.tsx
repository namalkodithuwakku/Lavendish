"use client";

import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { firstAllowedPage, hasPageAccess, pageCodeForPath } from "./page-access";

type Access = { role:"MASTER_ADMIN"|"HEAD_OFFICE"|"GM"|"VIEWER"; hotel_codes:string[]; page_codes:string[]; active:boolean };
type AuthState = { session:Session|null; access:Access|null; loading:boolean; signOut:()=>Promise<void> };
const AuthContext=createContext<AuthState>({session:null,access:null,loading:true,signOut:async()=>{}});

export function AuthProvider({children}:{children:React.ReactNode}){
 const [session,setSession]=useState<Session|null>(null); const [access,setAccess]=useState<Access|null>(null); const [loading,setLoading]=useState(true);
 const accessRef=useRef<Access|null>(null); const userIdRef=useRef<string|null>(null);
 const pathname=usePathname(); const router=useRouter();
 useEffect(()=>{let mounted=true;async function apply(next:Session|null){if(!mounted)return;setSession(next);if(!next){userIdRef.current=null;accessRef.current=null;setAccess(null);setLoading(false);return}if(userIdRef.current===next.user.id&&accessRef.current){setLoading(false);return}if(!accessRef.current)setLoading(true);const {data}=await supabase.from("occupancy_user_access").select("role,hotel_codes,page_codes,active").eq("user_id",next.user.id).maybeSingle();if(!mounted)return;const normalized=data?{...data,page_codes:Array.isArray(data.page_codes)?data.page_codes:(data.role==="MASTER_ADMIN"?["ALL"]:["HOTEL_OCCUPANCY"])} as Access:null;userIdRef.current=next.user.id;accessRef.current=normalized;setAccess(normalized);setLoading(false)}supabase.auth.getSession().then(({data})=>apply(data.session));const {data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{void apply(next)});return()=>{mounted=false;listener.subscription.unsubscribe()}},[]);
 useEffect(()=>{if(loading)return;if(!session&&pathname!=="/login")router.replace("/login");if(session&&pathname==="/login")router.replace("/")},[loading,pathname,router,session]);
 async function signOut(){await supabase.auth.signOut();router.replace("/login")}
 if(loading)return <div className="auth-loading"><span>NK</span><p>Opening occupancy intelligence…</p></div>;
 if(!session&&pathname!=="/login")return null;
 if(session&&(!access||!access.active)&&pathname!=="/login")return <main className="access-blocked"><div><span>NK</span><h1>Access is not active</h1><p>Your login is valid, but no active hotel access has been assigned. Please contact the Master Admin.</p><button onClick={signOut}>Sign out</button></div></main>;
 const requiredPage=pageCodeForPath(pathname);
 if(session&&access&&requiredPage&&!hasPageAccess(access.page_codes,requiredPage)&&!pathname.startsWith("/admin/users"))return <main className="access-blocked"><div><span>NK</span><h1>Page access not assigned</h1><p>Your account does not have permission to view this page. Please contact the Master Admin.</p><button onClick={()=>router.replace(firstAllowedPage(access.page_codes))}>Open my dashboard</button></div></main>;
 return <AuthContext.Provider value={{session,access,loading,signOut}}>{children}</AuthContext.Provider>;
}
export function useAuth(){return useContext(AuthContext)}
