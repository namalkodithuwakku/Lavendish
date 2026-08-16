"use client";
import { useEffect,useMemo,useState } from "react";
import { useAuth } from "../../auth-provider";

type Result={hotel:string;status:string;rate:number|null;currency:string;availableCheckIn?:string;daysShifted?:number;source?:string;sourceUrl?:string};
type Analysis={checkedAt?:string;ourRate?:number|null;marketMedian?:number|null;suggestedRate?:number|null;occupancy?:number|null;confidence?:string;summary?:string;reason?:string;guide?:string;results?:Result[]};
type Hotel={id:string;name:string;code:string|null;location:string|null;analysis:Analysis|null;previousAnalysis:Analysis|null};

function money(rate:number|null|undefined,currency="USD"){return rate==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:0}).format(rate)}
function previousRate(previous:Analysis|null,name:string){return previous?.results?.find(item=>item.hotel.trim().toLowerCase()===name.trim().toLowerCase())?.rate??null}
function change(current:number|null,previous:number|null){if(current==null||previous==null)return null;return current-previous}

export function CompSetClient(){
 const {session}=useAuth(),[hotels,setHotels]=useState<Hotel[]>([]),[selected,setSelected]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{if(!session)return;let live=true;fetch("/api/comp-set",{headers:{Authorization:`Bearer ${session.access_token}`}}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not load Comp Set");if(live){setHotels(data.hotels??[]);setSelected(current=>current||(data.hotels?.[0]?.id??""))}}).catch(reason=>live&&setError(reason.message)).finally(()=>live&&setLoading(false));return()=>{live=false}},[session]);
 const hotel=useMemo(()=>hotels.find(item=>item.id===selected)??hotels[0],[hotels,selected]),analysis=hotel?.analysis,previous=hotel?.previousAnalysis,results=analysis?.results??[],changed=results.filter(item=>change(item.rate,previousRate(previous,item.hotel))!==0&&change(item.rate,previousRate(previous,item.hotel))!==null).length;
 return <div className="intel-page comp-page">
  <section className="comp-command"><div><small>READ-ONLY RATE MONITOR</small><h2>Competitive rate position</h2><p>Latest automated prices, movements and revenue guidance for the selected hotel.</p></div><label><span>HOTEL</span><select value={selected} onChange={event=>setSelected(event.target.value)}>{hotels.map(item=><option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label></section>
  <section className="comp-schedule"><div><span>Automatic checks</span><b>06:00 · 11:00 · 15:00</b><small>Sri Lanka time · no competitor editing on this page</small></div><div><span>Last checked</span><b>{analysis?.checkedAt?new Date(analysis.checkedAt).toLocaleString():"Waiting for first run"}</b><small>{changed} rate {changed===1?"change":"changes"} in latest comparison</small></div></section>
  {error&&<div className="comp-empty error">{error}</div>}{loading&&<div className="comp-empty">Loading rate intelligence…</div>}
  {!loading&&!analysis&&<div className="comp-empty"><b>No completed check yet</b><span>The next scheduled run will populate this hotel automatically.</span></div>}
  {analysis&&<><section className="comp-kpis"><article><span>OUR LIVE RATE</span><b>{money(analysis.ourRate)}</b><small>Public rate found automatically</small></article><article><span>MARKET MEDIAN</span><b>{money(analysis.marketMedian)}</b><small>Comparable verified rates</small></article><article className="accent"><span>SUGGESTED RATE</span><b>{money(analysis.suggestedRate)}</b><small>{analysis.confidence??"LOW"} confidence</small></article><article><span>OCCUPANCY</span><b>{analysis.occupancy==null?"—":`${analysis.occupancy}%`}</b><small>Selected stay date</small></article></section>
  <section className="comp-guidance"><div><small>SMART RECOMMENDATION</small><h3>{analysis.guide??"Review the latest market position."}</h3><p>{analysis.reason??analysis.summary}</p></div></section>
  <section className="comp-table"><header><span>Competitor</span><span>Previous</span><span>Current</span><span>Movement</span><span>Availability</span></header>{results.map(item=>{const prior=previousRate(previous,item.hotel),delta=change(item.rate,prior),direction=delta==null?"new":delta>0?"up":delta<0?"down":"hold";return <article key={item.hotel}><div><b>{item.hotel}</b><small>{item.source??"Google Hotels"}</small></div><span>{money(prior,item.currency)}</span><strong>{money(item.rate,item.currency)}</strong><span className={direction}>{delta==null?"NEW":delta===0?"—":`${delta>0?"↑":"↓"} ${money(Math.abs(delta),item.currency)}`}</span><span className={item.rate==null?"missing":"available"}>{item.rate==null?"No rate":item.daysShifted?`+${item.daysShifted} day fallback`:"Requested date"}</span></article>})}</section></>}
 </div>
}
