import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";
const ALLOWED_STATUSES=["PENDING","STARTED","COMPLETED","DISMISSED"] as const;
type AlertStatus=typeof ALLOWED_STATUSES[number];

function adminClient(){
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!key)throw new Error("Admin service is not configured");
  return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const authorization=request.headers.get("authorization")??"";
  const token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
  if(!token)return NextResponse.json({error:"Authentication required"},{status:401});
  const client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await client.auth.getUser(token);
  if(userError||!user)return NextResponse.json({error:"Invalid session"},{status:401});
  const {data:access}=await client.from("occupancy_user_access").select("hotel_codes,active,role").eq("user_id",user.id).maybeSingle();
  if(!access?.active||access.role!=="MASTER_ADMIN")return NextResponse.json({error:"Master Admin access is required"},{status:403});
  const {id}=await params;
  const body=await request.json() as {status?:string};
  const status=String(body.status??"") as AlertStatus;
  if(!ALLOWED_STATUSES.includes(status))return NextResponse.json({error:"Invalid alert status"},{status:400});
  const admin=adminClient();
  const {data:alert,error:alertError}=await admin.from("yield_alerts").select("id,hotel_code").eq("id",id).maybeSingle();
  if(alertError||!alert)return NextResponse.json({error:"Alert not found"},{status:404});
  const hotelCodes=access.hotel_codes as string[];
  if(!hotelCodes.includes("ALL")&&!hotelCodes.includes(alert.hotel_code))return NextResponse.json({error:"Hotel access denied"},{status:403});
  const now=new Date().toISOString();
  const workflow=status==="STARTED"?{followed_by:user.id,followed_at:now}:status==="COMPLETED"?{actioned_by:user.id,actioned_at:now}:status==="DISMISSED"?{dismissed_by:user.id,dismissed_at:now}:{};
  const {data,error}=await admin.from("yield_alerts").update({status,...workflow,updated_at:now}).eq("id",id).select("id,status,updated_at").single();
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({success:true,alert:data});
}
