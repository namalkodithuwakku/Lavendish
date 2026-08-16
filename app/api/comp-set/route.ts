import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic="force-dynamic";
const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

function adminClient(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function accessFor(request:NextRequest){const authorization=request.headers.get("authorization")??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";if(!token)return null;const auth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),{data:{user}}=await auth.auth.getUser(token);if(!user)return null;const {data}=await adminClient().from("occupancy_user_access").select("role,hotel_codes,page_codes,active").eq("user_id",user.id).maybeSingle();if(!data?.active||!(data.page_codes??[]).some((code:string)=>code==="ALL"||code==="COMP_SET"))return null;return data}

export async function GET(request:NextRequest){
 try{
  const access=await accessFor(request);if(!access)return NextResponse.json({error:"Comp Set access required"},{status:403});
  const db=adminClient(),{data,error}=await db.from("properties").select("id,name,location,legacy_hotel_code,property_profiles(profile_data,updated_at)").order("name");if(error)throw error;
  const allowed=new Set<string>(access.hotel_codes??[]),all=allowed.has("ALL")||access.role==="MASTER_ADMIN";
  const hotels=(data??[]).filter(property=>all||allowed.has(property.legacy_hotel_code??"")).map(property=>{
   const relation=property.property_profiles as unknown,profiles=Array.isArray(relation)?relation:relation?[relation]:[],profile=profiles[0] as {profile_data?:Record<string,unknown>;updated_at?:string}|undefined,data=profile?.profile_data??{};
   const set=data.competitorSet as {main?:Array<{name?:string;active?:boolean}>}|undefined,mainCompetitors=(set?.main??[]).filter(item=>item.active!==false&&item.name?.trim()).slice(0,4).map(item=>item.name!.trim());return {id:property.id,name:property.name,code:property.legacy_hotel_code,location:property.location,mainCompetitors,analysis:data.competitorRateAnalysis??null,previousAnalysis:data.competitorRatePreviousAnalysis??null,updatedAt:profile?.updated_at??null};
  });
  return NextResponse.json({hotels,schedule:["06:00","11:00","15:00"],timezone:"Asia/Colombo"});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not load Comp Set"},{status:500})}
}
