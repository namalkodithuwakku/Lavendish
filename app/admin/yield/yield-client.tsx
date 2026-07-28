"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth-provider";
import { supabase } from "../../supabase";
import "./failure-details.css";

type Band={id:string;sold_from:number;sold_to:number;rate:number;display_order:number;isNew?:boolean};
type Plan={id:string;hotel_code:string;plan_code:string;plan_name:string;currency:string;effective_from:string;effective_to:string|null;active:boolean;review_note:string|null;yield_rate_bands:Band[]};
type PlanDraft={id?:string;plan_code:string;plan_name:string;currency:string;effective_from:string;effective_to:string;active:boolean;review_note:string};
type Settings={hotel_code:string;alert_thresholds:number[];enabled_rate_durations:string[];default_rate_duration:string;future_check_days:number;threshold_75_action:string;threshold_90_action:string;threshold_100_action:string};
const HOTELS=[["MLR","Miridiya Lake Resort"],["GTL","Grand Tamarind Lake"],["LOH","Lavendish Okrin Hotel"],["LWS","Lavendish Wild Safari"],["LWW","Lavendish Wild Wilpattu"],["LCR","Lavendish Country Resort"],["LLG","Lavendish Lake Giritale"],["LHK","Lavendish Hills Kandy"],["TLK","Tamarind Lifestyle - Kataragama"],["LBU","Lavendish Beach Unawatuna"]];
const DURATIONS=[["1_DAY","1 day"],["3_DAYS","3 days"],["7_DAYS","7 days"],["1_MONTH","1 month"],["3_MONTHS","3 months"],["6_MONTHS","6 months"]];
const ACTIONS=[["OFF","Off"],["NOTIFY","Notify"],["RECOMMEND","Recommend action"],["CREATE_TASK","Create NK task"]];
const today=()=>new Date().toISOString().slice(0,10);
const blankPlan=():PlanDraft=>({plan_code:"",plan_name:"",currency:"USD",effective_from:today(),effective_to:"",active:true,review_note:""});

export default function YieldClient(){
  const {access,session}=useAuth();
  const [hotel,setHotel]=useState("MLR"),[plans,setPlans]=useState<Plan[]>([]),[settings,setSettings]=useState<Settings|null>(null),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[checkSummary,setCheckSummary]=useState(""),[failureDetails,setFailureDetails]=useState<string[]>([]),[notice,setNotice]=useState(""),[draft,setDraft]=useState<PlanDraft|null>(null),[copySource,setCopySource]=useState<Plan|null>(null),[confirmDelete,setConfirmDelete]=useState<Plan|null>(null);
  const hotelName=HOTELS.find(([code])=>code===hotel)?.[1]??hotel;
  const selectedPlans=useMemo(()=>plans.filter(plan=>plan.hotel_code===hotel),[plans,hotel]);
  const load=useCallback(async()=>{
    setBusy(true);
    const [planResult,settingResult]=await Promise.all([
      supabase.from("yield_rate_plans").select("id,hotel_code,plan_code,plan_name,currency,effective_from,effective_to,active,review_note,yield_rate_bands(id,sold_from,sold_to,rate,display_order)").order("plan_code"),
      supabase.from("yield_settings").select("*").eq("hotel_code",hotel).maybeSingle()
    ]);
    if(planResult.error||settingResult.error)setNotice(planResult.error?.message??settingResult.error?.message??"Could not load yield settings");
    else{
      setPlans((planResult.data??[]).map(plan=>({...plan,yield_rate_bands:[...(plan.yield_rate_bands??[])].sort((a,b)=>a.display_order-b.display_order)})) as Plan[]);
      setSettings(settingResult.data as Settings);
    }
    setBusy(false);
  },[hotel]);
  useEffect(()=>{void load()},[load]);
  function changeBand(planId:string,bandId:string,key:"sold_from"|"sold_to"|"rate",value:number){setPlans(current=>current.map(plan=>plan.id===planId?{...plan,yield_rate_bands:plan.yield_rate_bands.map(band=>band.id===bandId?{...band,[key]:value}:band)}:plan))}
  function addBand(planId:string){setPlans(current=>current.map(plan=>{if(plan.id!==planId)return plan;const last=plan.yield_rate_bands.at(-1);return{...plan,yield_rate_bands:[...plan.yield_rate_bands,{id:crypto.randomUUID(),sold_from:(last?.sold_to??-1)+1,sold_to:(last?.sold_to??-1)+1,rate:last?.rate??0,display_order:plan.yield_rate_bands.length+1,isNew:true}]}}))}
  async function removeBand(plan:Plan,band:Band){if(plan.yield_rate_bands.length===1){setNotice("A rate plan must keep at least one occupancy band.");return}if(!band.isNew){const {error}=await supabase.from("yield_rate_bands").delete().eq("id",band.id);if(error){setNotice(error.message);return}}setPlans(current=>current.map(item=>item.id===plan.id?{...item,yield_rate_bands:item.yield_rate_bands.filter(entry=>entry.id!==band.id)}:item))}
  function validBands(plan:Plan){return plan.yield_rate_bands.every((band,index,list)=>band.sold_from<=band.sold_to&&band.rate>=0&&(index===0||band.sold_from>list[index-1].sold_to))}
  async function saveRates(){
    const invalid=selectedPlans.find(plan=>!validBands(plan));if(invalid){setNotice(`${invalid.plan_name} has overlapping or reversed room ranges.`);return}
    setBusy(true);
    for(const plan of selectedPlans){
      const existing=plan.yield_rate_bands.filter(b=>!b.isNew).map(({id,sold_from,sold_to,rate,display_order})=>({id,sold_from,sold_to,rate,display_order,updated_at:new Date().toISOString()}));
      const added=plan.yield_rate_bands.filter(b=>b.isNew).map(({sold_from,sold_to,rate,display_order})=>({rate_plan_id:plan.id,sold_from,sold_to,rate,display_order}));
      if(existing.length){const {error}=await supabase.from("yield_rate_bands").upsert(existing);if(error){setNotice(error.message);setBusy(false);return}}
      if(added.length){const {error}=await supabase.from("yield_rate_bands").insert(added);if(error){setNotice(error.message);setBusy(false);return}}
    }
    setNotice(`Rates saved for ${hotelName}.`);await load();
  }
  function openEdit(plan:Plan){setDraft({id:plan.id,plan_code:plan.plan_code,plan_name:plan.plan_name,currency:plan.currency,effective_from:plan.effective_from,effective_to:plan.effective_to??"",active:plan.active,review_note:plan.review_note??""});setCopySource(null)}
  function openCopy(plan:Plan){setCopySource(plan);setDraft({plan_code:`${plan.plan_code}_COPY`,plan_name:`${plan.plan_name} copy`,currency:plan.currency,effective_from:today(),effective_to:"",active:true,review_note:`Copied from ${plan.plan_code}`})}
  async function savePlan(event:FormEvent){
    event.preventDefault();if(!draft)return;
    const code=draft.plan_code.trim().toUpperCase().replace(/[^A-Z0-9_]/g,"_"),name=draft.plan_name.trim();
    if(!code||!name){setNotice("Plan name and code are required.");return}
    if(draft.effective_to&&draft.effective_to<draft.effective_from){setNotice("Effective end date cannot be before the start date.");return}
    setBusy(true);
    const payload={hotel_code:hotel,plan_code:code,plan_name:name,currency:draft.currency.trim().toUpperCase(),effective_from:draft.effective_from,effective_to:draft.effective_to||null,active:draft.active,review_note:draft.review_note.trim()||null,created_by:session?.user.id,updated_at:new Date().toISOString()};
    if(draft.id){const {error}=await supabase.from("yield_rate_plans").update(payload).eq("id",draft.id);if(error){setNotice(error.message);setBusy(false);return}}
    else{
      const {data,error}=await supabase.from("yield_rate_plans").insert(payload).select("id").single();
      if(error||!data){setNotice(error?.message??"Could not create the rate plan.");setBusy(false);return}
      const sourceBands=copySource?.yield_rate_bands??[{sold_from:0,sold_to:0,rate:0,display_order:1}];
      const {error:bandError}=await supabase.from("yield_rate_bands").insert(sourceBands.map(({sold_from,sold_to,rate,display_order})=>({rate_plan_id:data.id,sold_from,sold_to,rate,display_order})));
      if(bandError){await supabase.from("yield_rate_plans").delete().eq("id",data.id);setNotice(bandError.message);setBusy(false);return}
    }
    setDraft(null);setCopySource(null);setNotice(draft.id?"Rate plan updated.":`${name} was created.`);await load();
  }
  async function deletePlan(){if(!confirmDelete)return;setBusy(true);const {error}=await supabase.from("yield_rate_plans").delete().eq("id",confirmDelete.id);setNotice(error?error.message:`${confirmDelete.plan_name} was deleted.`);setConfirmDelete(null);setBusy(false);if(!error)await load()}
  async function saveSettings(event:FormEvent){event.preventDefault();if(!settings)return;setBusy(true);const {error}=await supabase.from("yield_settings").upsert({...settings,updated_by:session?.user.id,updated_at:new Date().toISOString()},{onConflict:"hotel_code"});setNotice(error?error.message:`Notification rules saved for ${hotelName}.`);setBusy(false)}
  async function runYieldCheck(){
    if(!session)return;
    setChecking(true);
    setCheckSummary("");
    setFailureDetails([]);
    setNotice("");
    let checkedDates=0,createdAlerts=0,baselines=0,failures=0;
    const failureMessages:string[]=[];
    try{
      for(let index=0;index<HOTELS.length;index++){
        const [code,name]=HOTELS[index];
        setCheckSummary(`Checking ${index+1} of ${HOTELS.length}: ${name}…`);
        const response=await fetch(`/api/yield/check?hotel=${encodeURIComponent(code)}`,{
          method:"POST",
          cache:"no-store",
          headers:{Authorization:`Bearer ${session.access_token}`}
        });
        const responseText=await response.text();
        let result:{success?:boolean;error?:string;checkedDates?:number;createdAlerts?:number;baselines?:number;failures?:string[]};
        try{result=JSON.parse(responseText)}
        catch{throw new Error(`${name} check ended unexpectedly. Please retry after the current deployment is ready.`)}
        if(!response.ok||!result.success)throw new Error(result.error??`${name} yield check failed`);
        checkedDates+=Number(result.checkedDates??0);
        createdAlerts+=Number(result.createdAlerts??0);
        baselines+=Number(result.baselines??0);
        failures+=Number(result.failures?.length??0);
        failureMessages.push(...(result.failures??[]));
        setCheckSummary(`${index+1} of ${HOTELS.length} hotels complete • ${checkedDates} dates checked • ${createdAlerts} new alerts • ${baselines} first-time snapshots${failures?` • ${failures} read failures`:""}`);
      }
      setFailureDetails(failureMessages);
    }catch(error){
      setNotice(error instanceof Error?error.message:"Yield check failed");
    }finally{
      setChecking(false);
    }
  }
  if(access?.role!=="MASTER_ADMIN")return <main className="access-blocked"><div><span>NK</span><h1>Master access required</h1><Link href="/">Return to dashboard</Link></div></main>;
  return <main className="admin-shell">
    <aside className="admin-nav"><div className="admin-brand"><span>NK</span><div><b>N K Hotels</b><small>Lavendish Management</small></div></div><nav><Link href="/">⌂ <span>Occupancy dashboard</span></Link><Link href="/admin">▦ <span>Hotel profiles</span></Link><Link href="/admin/users">♙ <span>Users & access</span></Link><Link className="active" href="/admin/yield">↗ <span>Yield rules</span></Link></nav><div className="admin-identity"><span>NK</span><div><b>{session?.user.user_metadata?.full_name??"Master"}</b><small>Master Admin</small></div></div></aside>
    <section className="admin-page yield-page">
      <header className="admin-header"><div><p>YIELD CONTROL</p><h1>Rates & notification rules</h1><span>All values are editable. Changes apply without changing application code.</span></div><div className="yield-check-control"><button disabled={checking} onClick={()=>void runYieldCheck()}>{checking?"Checking all hotels…":"Run occupancy check now"}</button>{checkSummary&&<small>{checkSummary}</small>}</div></header>
      {failureDetails.length>0&&<details className="yield-failure-panel"><summary><span>!</span><div><b>{failureDetails.length} Sheet reads need attention</b><small>Open to see the exact hotel, month and reader error.</small></div><i>View details</i></summary><div className="yield-failure-list">{failureDetails.map((failure,index)=><div key={`${failure}-${index}`}><span>{index+1}</span><p>{failure}</p></div>)}</div></details>}
      <section className="yield-hotel-bar"><label><span>SELECT HOTEL</span><select value={hotel} onChange={e=>setHotel(e.target.value)}>{HOTELS.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label><div><b>{hotelName}</b><small>{selectedPlans.length} rate {selectedPlans.length===1?"plan":"plans"}</small></div></section>
      <section className="admin-panel">
        <div className="admin-panel-head"><div><h2>Rate plans</h2><p>Create OTA BB, OTA RO or any future plan without a code update.</p></div><div className="rate-plan-actions"><button type="button" disabled={busy} onClick={()=>{setDraft(blankPlan());setCopySource(null)}}>+ Add rate plan</button><button className="primary-admin-button" disabled={busy||!selectedPlans.length} onClick={saveRates}>Save all bands</button></div></div>
        {selectedPlans.map(plan=><article className={`rate-plan-card ${plan.active?"":"inactive-plan"}`} key={plan.id}>
          <header><div><b>{plan.plan_name}</b><span>{plan.plan_code}</span>{!plan.active&&<em>Inactive</em>}</div><div className="plan-tools"><strong>{plan.currency}</strong><button onClick={()=>openEdit(plan)}>Edit</button><button onClick={()=>openCopy(plan)}>Copy</button><button className="danger-link" onClick={()=>setConfirmDelete(plan)}>Delete</button></div></header>
          <div className="plan-dates"><span>Effective: {plan.effective_from}</span><span>{plan.effective_to?`Until: ${plan.effective_to}`:"No end date"}</span></div>
          {plan.review_note&&<p className="review-note">Review: {plan.review_note}</p>}
          <div className="band-grid"><div className="band-head"><span>Rooms sold from</span><span>Rooms sold to</span><span>Recommended rate</span><span /></div>{plan.yield_rate_bands.map(band=><div className="band-row" key={band.id}><input aria-label="Rooms sold from" type="number" min="0" value={band.sold_from} onChange={e=>changeBand(plan.id,band.id,"sold_from",Number(e.target.value))}/><input aria-label="Rooms sold to" type="number" min="0" value={band.sold_to} onChange={e=>changeBand(plan.id,band.id,"sold_to",Number(e.target.value))}/><label><span>{plan.currency}</span><input aria-label="Recommended rate" type="number" min="0" step=".01" value={band.rate} onChange={e=>changeBand(plan.id,band.id,"rate",Number(e.target.value))}/></label><button className="remove-band" onClick={()=>void removeBand(plan,band)} aria-label="Remove rate band">×</button></div>)}</div>
          <button className="add-band" onClick={()=>addBand(plan.id)}>+ Add occupancy band</button>
        </article>)}
        {!busy&&!selectedPlans.length&&<div className="empty-yield"><p>No rate plans are configured for this hotel.</p><button onClick={()=>setDraft(blankPlan())}>Create first rate plan</button></div>}
      </section>
      {settings&&<form className="admin-panel notification-panel" onSubmit={saveSettings}><div className="admin-panel-head"><div><h2>Occupancy notifications</h2><p>Each alert includes stay date, rooms sold, total rooms, available rooms and occupancy percentage.</p></div><button className="primary-admin-button" disabled={busy}>Save notification rules</button></div><div className="threshold-grid">{[0,1,2].map(index=><label key={index}><span>LEVEL {index+1}</span><div><input type="number" min="1" max="100" value={settings.alert_thresholds[index]} onChange={e=>setSettings({...settings,alert_thresholds:settings.alert_thresholds.map((v,i)=>i===index?Number(e.target.value):v)})}/><b>%</b></div><select value={[settings.threshold_75_action,settings.threshold_90_action,settings.threshold_100_action][index]} onChange={e=>setSettings({...settings,[["threshold_75_action","threshold_90_action","threshold_100_action"][index]]:e.target.value})}>{ACTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}</div><div className="duration-section"><div><b>Allowed rate update ranges</b><small>Hotel managers see only the ranges enabled here.</small></div><div className="duration-grid">{DURATIONS.map(([value,label])=><label className={settings.enabled_rate_durations.includes(value)?"selected":""} key={value}><input type="checkbox" checked={settings.enabled_rate_durations.includes(value)} onChange={e=>setSettings({...settings,enabled_rate_durations:e.target.checked?[...settings.enabled_rate_durations,value]:settings.enabled_rate_durations.filter(item=>item!==value)})}/><span>{label}</span></label>)}</div></div><label className="future-days"><span>Check future occupancy up to</span><div><input type="number" min="1" max="366" value={settings.future_check_days} onChange={e=>setSettings({...settings,future_check_days:Number(e.target.value)})}/><b>days ahead</b></div></label></form>}
      <section className="architecture-note"><span>✓</span><div><b>Safe workflow</b><p>The engine recommends rates and creates NK team tasks. It never changes Google Sheets or OTA extranets automatically. Duplicate active alerts for the same hotel, date and threshold are blocked.</p></div></section>
    </section>
    {draft&&<div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target){setDraft(null);setCopySource(null)}}}><form className="profile-modal plan-modal" onSubmit={savePlan}><div className="modal-head"><div><p>RATE PLAN</p><h2>{draft.id?"Edit rate plan":copySource?"Copy rate plan":"Add rate plan"}</h2></div><button type="button" onClick={()=>{setDraft(null);setCopySource(null)}}>×</button></div><div className="form-grid"><label className="wide"><span>Plan name *</span><input required value={draft.plan_name} onChange={e=>setDraft({...draft,plan_name:e.target.value})} placeholder="OTA Room Only"/></label><label><span>Plan code *</span><input required value={draft.plan_code} onChange={e=>setDraft({...draft,plan_code:e.target.value})} placeholder="OTA_RO"/></label><label><span>Currency *</span><input required maxLength={3} value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value})} placeholder="USD"/></label><label><span>Effective from *</span><input required type="date" value={draft.effective_from} onChange={e=>setDraft({...draft,effective_from:e.target.value})}/></label><label><span>Effective to</span><input type="date" value={draft.effective_to} onChange={e=>setDraft({...draft,effective_to:e.target.value})}/></label><label><span>Status</span><select value={draft.active?"Active":"Inactive"} onChange={e=>setDraft({...draft,active:e.target.value==="Active"})}><option>Active</option><option>Inactive</option></select></label><label className="wide"><span>Master note</span><input value={draft.review_note} onChange={e=>setDraft({...draft,review_note:e.target.value})} placeholder="Optional internal note"/></label></div>{copySource&&<div className="copy-message">All {copySource.yield_rate_bands.length} occupancy bands will be copied from {copySource.plan_name}. You can change the new rates after creation.</div>}<div className="modal-actions"><button type="button" onClick={()=>{setDraft(null);setCopySource(null)}}>Cancel</button><button className="save-profile" disabled={busy}>{draft.id?"Save plan":"Create rate plan"}</button></div></form></div>}
    {confirmDelete&&<div className="modal-backdrop"><section className="delete-confirm"><span>!</span><h2>Delete {confirmDelete.plan_name}?</h2><p>This permanently removes the plan and all its occupancy bands. Existing alert history remains available.</p><div><button onClick={()=>setConfirmDelete(null)}>Cancel</button><button className="delete-plan" disabled={busy} onClick={()=>void deletePlan()}>Delete rate plan</button></div></section></div>}
    {notice&&<button className="admin-toast" onClick={()=>setNotice("")}>✓ {notice}</button>}
  </main>
}
