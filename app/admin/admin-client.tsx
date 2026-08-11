"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth-provider";
import { supabase } from "../supabase";

type Profile = { code:string; name:string; location:string; rooms:number|null; sheetUrl:string; yearTab:string; status:"Active"|"Inactive" };

const initialProfiles: Profile[] = [
  { code:"MLR", name:"Miridiya Lake Resort", location:"Anuradhapura", rooms:38, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"GTL", name:"Grand Tamarind Lake", location:"Kataragama", rooms:25, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LOH", name:"Lavendish Okrin Hotel", location:"Kataragama", rooms:17, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LWS", name:"Lavendish Wild Safari", location:"Wasgamuwa", rooms:27, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LWW", name:"Lavendish Wild Wilpattu", location:"Wilpattu", rooms:12, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LCR", name:"Lavendish Country Resort", location:"Dambulla", rooms:18, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LLG", name:"Lavendish Lake Giritale", location:"Giritale", rooms:42, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LHK", name:"Lavendish Hills Kandy", location:"Kandy", rooms:43, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LTL", name:"Lavendish Tamarind Lifestyle", location:"Kataragama", rooms:17, sheetUrl:"", yearTab:"2026", status:"Active" },
  { code:"LBR", name:"Lavendish Beach Resort", location:"Unawatuna", rooms:40, sheetUrl:"", yearTab:"2026", status:"Active" },
];
const blank: Profile = { code:"", name:"", location:"", rooms:null, sheetUrl:"", yearTab:"2026", status:"Active" };

export default function AdminClient({ adminName, adminEmail }: { adminName:string; adminEmail:string }) {
  const { access, session } = useAuth();
  adminEmail = session?.user.email ?? adminEmail;
  adminName = String(session?.user.user_metadata?.full_name ?? adminName);
  const [profiles,setProfiles] = useState(initialProfiles);
  const [editing,setEditing] = useState<Profile|null>(null);
  const [query,setQuery] = useState("");
  const [notice,setNotice] = useState("");
  const filtered = useMemo(() => profiles.filter(h => `${h.name} ${h.location} ${h.code}`.toLowerCase().includes(query.toLowerCase())),[profiles,query]);
  const connected = profiles.filter(p => p.sheetUrl.trim()).length;
  const initials = adminName.split(" ").map(p => p[0]).join("").slice(0,2);

  useEffect(()=>{supabase.from("occupancy_profiles").select("hotel_code,hotel_name,location,total_rooms,google_sheet_url,google_spreadsheet_id,active_year_tab,status").order("display_order").then(({data,error})=>{if(error){setNotice(`Database connection: ${error.message}`);return}if(data)setProfiles(data.map(row=>({code:row.hotel_code,name:row.hotel_name,location:row.location??"",rooms:row.total_rooms,sheetUrl:row.google_spreadsheet_id??row.google_sheet_url??"",yearTab:row.active_year_tab,status:row.status as Profile["status"]})))})},[]);

  function update<K extends keyof Profile>(key:K,value:Profile[K]) { setEditing(current => current ? {...current,[key]:value}:current); }
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!editing) return;
    const rawSheet=editing.sheetUrl.trim();
    const match=rawSheet.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const next={...editing,code:editing.code.trim().toUpperCase(),name:editing.name.trim(),sheetUrl:match?.[1]??rawSheet};
    const {error}=await supabase.from("occupancy_profiles").upsert({hotel_code:next.code,hotel_name:next.name,short_name:next.name,location:next.location,total_rooms:next.rooms,google_spreadsheet_id:next.sheetUrl||null,active_year_tab:next.yearTab,status:next.status,updated_at:new Date().toISOString()},{onConflict:"hotel_code"});
    if(error){setNotice(`Could not save: ${error.message}`);window.setTimeout(()=>setNotice(""),6000);return}
    const found=profiles.findIndex(p => p.code===next.code);
    setProfiles(found>=0?profiles.map((p,i)=>i===found?next:p):[...profiles,next]);
    setEditing(null); setNotice(`${next.name} was saved to Supabase.`);
    window.setTimeout(()=>setNotice(""),4500);
  }

  if (access?.role !== "MASTER_ADMIN") return <main className="access-blocked"><div><span>NK</span><h1>Admin access required</h1><p>This area is available only to the Master Admin.</p><Link href="/">Return to dashboard</Link></div></main>;
  return <main className="admin-shell">
    <aside className="admin-nav">
      <div className="admin-brand"><span>NK</span><div><b>N K Hotels</b><small>Lavendish Management</small></div></div>
      <nav>
        <Link href="/">⌂ <span>Occupancy dashboard</span></Link>
        <Link className="active" href="/admin">▦ <span>Hotel profiles</span></Link>
        <Link href="/admin/users">♙ <span>Users & access</span></Link>
        <Link href="/admin/yield">↗ <span>Yield rules</span></Link>
        <Link href="/alerts/ota">◉ <span>OTA alerts</span></Link>
        <Link href="/alerts/yield">⌁ <span>Yield alerts</span></Link>
        <button>⌁ <span>Sheet reader</span><i>Soon</i></button>
        <button>⚙ <span>Settings</span><i>Soon</i></button>
      </nav>
      <div className="admin-identity"><span>{initials}</span><div><b>{adminName}</b><small>Master Admin</small></div></div>
    </aside>

    <section className="admin-page">
      <header className="admin-header">
        <div><p>ADMIN CONTROL</p><h1>Hotel profiles</h1><span>Manage Lavendish hotels and their live Google Sheet connections.</span></div>
        <div className="secure-user"><i>✓</i><div><b>Secure admin access</b><small>{adminEmail}</small></div></div>
      </header>

      <section className="admin-stats">
        <article><span>Total hotels</span><b>{profiles.length}</b><small>Lavendish portfolio</small></article>
        <article><span>Active hotels</span><b>{profiles.filter(p=>p.status==="Active").length}</b><small>Shown to managers</small></article>
        <article><span>Sheets connected</span><b>{connected}<em>/ {profiles.length}</em></b><small>{profiles.length-connected} links still required</small></article>
        <article><span>Database</span><b className="status-word">Live</b><small>Supabase connected</small></article>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div><h2>Lavendish hotel portfolio</h2><p>All 10 hotels are ready. Add only each original Google Spreadsheet ID.</p></div>
          <div className="admin-actions"><label>⌕<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search hotels" /></label><button onClick={()=>setEditing({...blank})}>+ Add hotel</button></div>
        </div>
        <div className="profile-table">
          <div className="profile-head"><span>Hotel</span><span>Rooms</span><span>Year tab</span><span>Google Sheet</span><span>Status</span><span /></div>
          {filtered.map(profile=><div className="profile-row" key={profile.code}>
            <div className="profile-hotel"><span>{profile.code}</span><div><b>{profile.name}</b><small>{profile.location}</small></div></div>
            <strong>{profile.rooms??"—"}</strong><code>{profile.yearTab}</code>
            <div className={`connection ${profile.sheetUrl?"connected":"missing"}`}><i />{profile.sheetUrl?"Connected":"Link required"}</div>
            <span className={`profile-status ${profile.status.toLowerCase()}`}>{profile.status}</span>
            <button className="edit-button" onClick={()=>setEditing({...profile})}>Edit</button>
          </div>)}
        </div>
      </section>

      <section className="architecture-note"><span>↻</span><div><b>How the live connection will work</b><p>Supabase stores hotel profiles and permissions. The secure reader opens the Google Sheet URL, identifies the year and monthly blocks using aliases, then refreshes the manager dashboard without changing the Sheet.</p></div></section>
    </section>

    {editing&&<div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)setEditing(null)}}>
      <form className="profile-modal" onSubmit={save}>
        <div className="modal-head"><div><p>HOTEL PROFILE</p><h2>{profiles.some(p=>p.code===editing.code)?"Edit hotel":"Add hotel"}</h2></div><button type="button" onClick={()=>setEditing(null)}>×</button></div>
        <div className="form-grid">
          <label className="wide"><span>Hotel name *</span><input required value={editing.name} onChange={e=>update("name",e.target.value)} placeholder="Lavendish Hotel Name" /></label>
          <label><span>Hotel code *</span><input required maxLength={6} value={editing.code} onChange={e=>update("code",e.target.value)} placeholder="LXX" /></label>
          <label><span>Location</span><input value={editing.location} onChange={e=>update("location",e.target.value)} placeholder="City" /></label>
          <label><span>Total rooms</span><input type="number" min="1" value={editing.rooms??""} onChange={e=>update("rooms",e.target.value?Number(e.target.value):null)} placeholder="Read from Sheet" /></label>
          <label><span>Active year tab</span><input value={editing.yearTab} onChange={e=>update("yearTab",e.target.value)} placeholder="2026" /></label>
          <label className="wide"><span>Google Spreadsheet ID *</span><input required value={editing.sheetUrl} onChange={e=>update("sheetUrl",e.target.value)} placeholder="Paste the Sheet ID or full Google Sheet link" /><small>You can paste the full link. The app keeps only the code between /d/ and /edit.</small></label>
          <label><span>Hotel status</span><select value={editing.status} onChange={e=>update("status",e.target.value as Profile["status"])}><option>Active</option><option>Inactive</option></select></label>
          <div className="read-only-check"><i>✓</i><div><b>Read-only connection</b><small>The app will not modify cells, formulas or formatting.</small></div></div>
        </div>
        <div className="modal-actions"><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button className="save-profile" type="submit">Save hotel profile</button></div>
      </form>
    </div>}
    {notice&&<div className="admin-toast">✓ {notice}</div>}
  </main>;
}
