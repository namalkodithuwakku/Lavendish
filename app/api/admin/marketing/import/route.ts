import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import masterPlan from "../../../../../data/marketing-master-plan.json";

const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

function adminClient(){
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!key)throw new Error("Admin service is not configured");
  return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function requireMaster(request:NextRequest){
  const authorization=request.headers.get("authorization")??"";
  const token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
  if(!token)return null;
  const client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user)return null;
  const {data:access}=await client.from("occupancy_user_access").select("role,active").eq("user_id",user.id).maybeSingle();
  return access?.active&&access.role==="MASTER_ADMIN"?user:null;
}

async function upsertBatches(client:ReturnType<typeof adminClient>,table:string,rows:unknown[],onConflict:string){
  for(let index=0;index<rows.length;index+=100){
    const {error}=await client.from(table).upsert(rows.slice(index,index+100),{onConflict});
    if(error)throw new Error(`${table}: ${error.message}`);
  }
}

export async function POST(request:NextRequest){
  const user=await requireMaster(request);
  if(!user)return NextResponse.json({error:"Master Admin access required"},{status:403});
  try{
    const admin=adminClient();
    await upsertBatches(admin,"marketing_campaigns",masterPlan.campaigns,"campaign_id");
    await upsertBatches(admin,"marketing_events",masterPlan.events,"event_id");
    await upsertBatches(admin,"marketing_content",masterPlan.content,"content_id");
    await upsertBatches(admin,"marketing_hotel_playbooks",masterPlan.playbooks,"hotel_code");
    await upsertBatches(admin,"marketing_creatives",masterPlan.creatives,"design_id");
    return NextResponse.json({success:true,version:masterPlan.version,counts:{campaigns:masterPlan.campaigns.length,events:masterPlan.events.length,content:masterPlan.content.length,playbooks:masterPlan.playbooks.length,creatives:masterPlan.creatives.length}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Marketing plan import failed"},{status:500});
  }
}
