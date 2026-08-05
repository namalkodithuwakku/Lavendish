"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth-provider";
import { supabase } from "../supabase";

type Mode="ota"|"yield";
type SuggestedRate={planCode:string;planName:string;currency:string;rate:number;soldFrom:number;soldTo:number};
type Alert={
  id:string;hotel_code:string;stay_date:string;alert_type:"RATE_UPDATE"|"OTA_CLOSURE"|"OTA_REOPEN"|"OCCUPANCY";
  threshold:number|null;total_rooms:number;rooms_sold:number;available_rooms:number;occupancy_percent:number;
  previous_rooms_sold:number|null;rooms_change:number|null;previous_available_rooms:number|null;
  previous_occupancy_percent:number|null;suggested_rates:SuggestedRate[]|null;action:string;
  status:"PENDING"|"STARTED"|"COMPLETED"|"DISMISSED"|"WITHDRAWN";created_at:string;updated_at:string;
};
const HOTELS:Record<string,string>={MLR:"Miridiya Lake Resort",GTL:"Grand Tamarind Lake",LOH:"Lavendish Okrin Hotel",LWS:"Lavendish Wild Safari",LWW:"Lavendish Wild Wilpattu",LCR:"Lavendish Country Resort",LLG:"Lavendish Lake Giritale",LHK:"Lavendish Hills Kandy",TLK:"Tamarind Lifestyle - Kataragama",LBU:"Lavendish Beach Unawatuna"};
const STATUS_LABELS:Record<string,string>={PENDING:"New",STARTED:"Following",COMPLETED:"Actioned",DISMISSED:"Dismissed",WITHDRAWN:"Withdrawn"};
const TYPE_LABELS:Record<string,string>={RATE_UPDATE:"Rate recommendation",OTA_CLOSURE:"Close OTAs",OTA_REOPEN:"Reopen OTAs",OCCUPANCY:"Adjust OTA inventory"};
const formatDate=(value:string)=>new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(new Date(`${value}T00:00:00`));

export default function AlertsClient({mode}:{mode:Mode}){
  const {access,session,signOut}=useAuth();
  const isMaster=access?.role==="MASTER_ADMIN";
  const [alerts,setAlerts]=useState<Alert[]>([]),[loading,setLoading]=useState(true),[checking,setChecking]=useState(false),[notice,setNotice]=useState(""),[hotel,setHotel]=useState("ALL"),[status,setStatus]=useState(mode==="ota"?"OPEN":"ALL"),[updating,setUpdating]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await supabase.from("yield_alerts").select("id,hotel_code,stay_date,alert_type,threshold,total_rooms,rooms_sold,available_rooms,occupancy_percent,previous_rooms_sold,rooms_change,previous_available_rooms,previous_occupancy_percent,suggested_rates,action,status,created_at,updated_at").order("created_at",{ascending:false}).limit(500);
    if(error)setNotice(error.message);else setAlerts((data??[]) as Alert[]);
    setLoading(false);
  },[]);
  useEffect(()=>{if(!session||!isMaster)return;void load();const timer=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(timer)},[isMaster,load,session]);
  const accessibleCodes=useMemo(()=>access?.hotel_codes.includes("ALL")?Object.keys(HOTELS):Object.keys(HOTELS).filter(code=>access?.hotel_codes.includes(code)),[access]);
  const hasFullPortfolioAccess=accessibleCodes.length===Object.keys(HOTELS).length;
  const pageAlerts=useMemo(()=>alerts.filter(alert=>mode==="yield"?alert.alert_type==="RATE_UPDATE":["OCCUPANCY","OTA_CLOSURE","OTA_REOPEN"].includes(alert.alert_type)),[alerts,mode]);
  const filtered=useMemo(()=>pageAlerts.filter(alert=>{
    if(hotel!=="ALL"&&alert.hotel_code!==hotel)return false;
    if(status==="OPEN"&&!["PENDING","STARTED"].includes(alert.status))return false;
    if(status!=="ALL"&&status!=="OPEN"&&alert.status!==status)return false;
    return true;
  }),[pageAlerts,hotel,status]);
  const counts=useMemo(()=>({new:pageAlerts.filter(a=>a.status==="PENDING").length,following:pageAlerts.filter(a=>a.status==="STARTED").length,actioned:pageAlerts.filter(a=>a.status==="COMPLETED").length,urgent:pageAlerts.filter(a=>a.status==="PENDING"&&(a.alert_type==="OTA_CLOSURE"||a.available_rooms<=0)).length}),[pageAlerts]);
  async function updateStatus(id:string,next:Alert["status"]){
    if(!session)return;setUpdating(id);setNotice("");
    try{const response=await fetch(`/api/alerts/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({status:next})}),result=await response.json();if(!response.ok)throw new Error(result.error??"Could not update alert");setAlerts(current=>current.map(alert=>alert.id===id?{...alert,status:next,updated_at:new Date().toISOString()}:alert))}
    catch(error){setNotice(error instanceof Error?error.message:"Could not update alert")}finally{setUpdating("")}
  }
  async function runMonitor(){if(!session)return;setChecking(true);setNotice("");try{const response=await fetch("/api/yield/check",{method:"POST",cache:"no-store",headers:{Authorization:`Bearer ${session.access_token}`}}),result=await response.json();if(!response.ok||!result.success)throw new Error(result.error??"Occupancy monitor failed");setNotice(`${result.hotels??0} hotels checked • ${result.checkedDates??0} stay dates • ${result.createdAlerts??0} new recommendations${result.failures?.length?` • ${result.failures.length} read issues`:""}`);await load()}catch(error){setNotice(error instanceof Error?error.message:"Occupancy monitor failed")}finally{setChecking(false)}}
  const profileName=String(session?.user.user_metadata?.full_name??session?.user.email?.split("@")[0]??"User"),firstName=profileName.trim().split(/\s+/)[0];
  if(!session||!access)return <main className="alerts-access-gate"><div><span>NK</span><h1>Checking secure access…</h1><p>Please wait while your Master Admin access is verified.</p></div></main>;
  if(!isMaster)return <main className="alerts-access-gate"><div><span>NK</span><h1>Master access required</h1><p>OTA and yield alerts are available only to the Master Admin.</p><Link href="/">Return to occupancy dashboard</Link></div></main>;
  return <main className="alerts-shell">
    <header className="alerts-topbar">
      <Link className="alerts-brand" href="/"><span>LH</span><div><b>Lavendish Intelligence</b><small>N K Hotels</small></div></Link>
      <nav><Link href="/">Occupancy</Link>{hasFullPortfolioAccess&&<Link href="/group-overview">Group overview</Link>}<Link className={mode==="ota"?"active":""} href="/alerts/ota">OTA updates</Link><Link className={mode==="yield"?"active":""} href="/alerts/yield">Yield alerts</Link>{access?.role==="MASTER_ADMIN"&&<Link href="/admin/yield">Yield setup</Link>}</nav>
      <button onClick={signOut}>{firstName} ↗</button>
    </header>
    <section className="alerts-page">
      <header className="alerts-title"><div><p>{mode==="ota"?"OTA MONITOR":"YIELD RECOMMENDATIONS"}</p><h1>{mode==="ota"?"OTA inventory actions":"Suggested rate changes"}</h1><span>{mode==="ota"?"Close, reopen or adjust channel-manager inventory when occupancy changes significantly.":"Suggested rates are selected from the active hotel formula and current rooms-sold band."}</span></div><button onClick={()=>void runMonitor()} disabled={checking||loading}>{checking?"Checking occupancy…":"Run occupancy monitor"}</button></header>
      <section className="alert-kpis"><article><span>New alerts</span><b>{counts.new}</b><small>Needs review</small></article><article><span>Following</span><b>{counts.following}</b><small>Staff is handling</small></article><article><span>Actioned</span><b>{counts.actioned}</b><small>Completed history</small></article><article className="urgent"><span>Urgent</span><b>{counts.urgent}</b><small>Sold out / closure</small></article></section>
      <section className="alerts-filter"><label><span>Hotel</span><select value={hotel} onChange={event=>setHotel(event.target.value)}><option value="ALL">All accessible hotels</option>{accessibleCodes.map(code=><option key={code} value={code}>{HOTELS[code]}</option>)}</select></label><div><span>Status</span><nav>{[["OPEN","Open"],["PENDING","New"],["STARTED","Following"],["COMPLETED","Actioned"],["DISMISSED","Dismissed"],["ALL","All"]].map(([value,label])=><button className={status===value?"active":""} key={value} onClick={()=>setStatus(value)}>{label}</button>)}</nav></div></section>
      {notice&&<div className="alert-notice">{notice}</div>}
      <section className="alerts-list">
        {filtered.map(alert=><article className={`alert-card ${alert.alert_type.toLowerCase()} ${alert.status.toLowerCase()}`} key={alert.id}>
          <div className="alert-card-top"><div className="alert-hotel"><span>{alert.hotel_code}</span><div><b>{HOTELS[alert.hotel_code]??alert.hotel_code}</b><small>Stay date: {formatDate(alert.stay_date)}</small></div></div><div className="alert-badges"><span className={`type ${alert.alert_type.toLowerCase()}`}>{TYPE_LABELS[alert.alert_type]}</span><span className={`status ${alert.status.toLowerCase()}`}>{STATUS_LABELS[alert.status]}</span></div></div>
          <div className="alert-position"><div><span>Previous sold</span><b>{alert.previous_rooms_sold??"—"}</b></div><i>→</i><div className="current"><span>Current sold</span><b>{alert.rooms_sold}<small> / {alert.total_rooms}</small></b></div><div className={Number(alert.rooms_change)>=0?"increase":"decrease"}><span>Change</span><b>{Number(alert.rooms_change)>0?"+":""}{alert.rooms_change??0}</b></div><div><span>Available</span><b>{alert.available_rooms}</b></div><div><span>Occupancy</span><b>{Math.round(Number(alert.occupancy_percent))}%</b></div></div>
          {mode==="yield"?<div className="alert-rates"><header><div><b>Suggested new rates</b><small>From the active rate formula for {alert.rooms_sold} rooms sold</small></div>{alert.threshold&&<span>{alert.threshold}% level</span>}</header>{alert.suggested_rates?.length?<div>{alert.suggested_rates.map(rate=><article key={rate.planCode}><span>{rate.planName}</span><b>{rate.currency} {Number(rate.rate).toLocaleString()}</b><small>Formula band {rate.soldFrom}–{rate.soldTo} rooms sold</small></article>)}</div>:<p>Add a matching rate band in Yield → Rate formula.</p>}</div>:<div className="alert-rates ota-recommendation"><header><div><b>Recommended channel-manager action</b><small>Based on the latest occupancy movement</small></div></header><p>{alert.alert_type==="OTA_CLOSURE"?"Close online channels for this stay date because no rooms remain available.":alert.alert_type==="OTA_REOPEN"?`Reopen online channels and load up to ${alert.available_rooms} available rooms.`:`Review OTA inventory after a ${Number(alert.rooms_change)>0?"rise":"drop"} of ${Math.abs(Number(alert.rooms_change??0))} room${Math.abs(Number(alert.rooms_change??0))===1?"":"s"} sold. Current availability is ${alert.available_rooms}.`}</p></div>}
          <footer><span>Detected {new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(alert.created_at))}</span><div>{alert.status!=="STARTED"&&alert.status!=="COMPLETED"&&<button disabled={updating===alert.id} onClick={()=>void updateStatus(alert.id,"STARTED")}>Follow</button>}{alert.status!=="COMPLETED"&&<button className="complete" disabled={updating===alert.id} onClick={()=>void updateStatus(alert.id,"COMPLETED")}>Mark actioned</button>}{alert.status!=="DISMISSED"&&alert.status!=="COMPLETED"&&<button className="dismiss" disabled={updating===alert.id} onClick={()=>void updateStatus(alert.id,"DISMISSED")}>Dismiss</button>}</div></footer>
        </article>)}
        {!loading&&!filtered.length&&<div className="alerts-empty"><span>✓</span><h2>No alerts in this view</h2><p>The latest occupancy check has no matching alerts for these filters.</p></div>}
      </section>
    </section>
  </main>
}
