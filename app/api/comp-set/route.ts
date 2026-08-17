import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic="force-dynamic";
const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

function adminClient(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function masterFor(request:NextRequest){const authorization=request.headers.get("authorization")??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";if(!token)return null;const auth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),{data:{user}}=await auth.auth.getUser(token);if(!user)return null;const {data}=await adminClient().from("occupancy_user_access").select("role,active").eq("user_id",user.id).maybeSingle();return data?.active&&data.role==="MASTER_ADMIN"?user:null}
function median(values:number[]){const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2}
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


export async function POST(request:NextRequest){
 try{
  const user=await masterFor(request);if(!user)return NextResponse.json({error:"Master Admin access required"},{status:403});
  const body=await request.json() as {propertyId?:string;ourRate?:number;rates?:Record<string,number>};if(!body.propertyId)return NextResponse.json({error:"Select a hotel first"},{status:400});
  const db=adminClient(),{data:property,error}=await db.from("properties").select("id,name,property_profiles(id,profile_data)").eq("id",body.propertyId).single();if(error||!property)throw error??new Error("Hotel not found");
  const relation=property.property_profiles as unknown,profiles=Array.isArray(relation)?relation:relation?[relation]:[],profile=profiles[0] as {id?:string;profile_data?:Record<string,unknown>}|undefined,profileData=profile?.profile_data??{},set=profileData.competitorSet as {main?:Array<{name?:string;active?:boolean}>;criteria?:{currency?:string}}|undefined,currency=set?.criteria?.currency||"USD",mainNames=(set?.main??[]).filter(item=>item.active!==false&&item.name?.trim()).slice(0,4).map(item=>item.name!.trim());
  if(!mainNames.length)return NextResponse.json({error:"No active Main competitors are saved for this hotel"},{status:400});
  const current=profileData.competitorRateAnalysis&&typeof profileData.competitorRateAnalysis==="object"?profileData.competitorRateAnalysis as Record<string,unknown>:{},currentResults=Array.isArray(current.results)?current.results as Array<Record<string,unknown>>:[],manualRates=body.rates??{},now=new Date().toISOString();
  const results=currentResults.map(item=>({...item}));for(const name of mainNames){const value=manualRates[name],index=results.findIndex(item=>String(item.hotel??"").trim().toLowerCase()===name.toLowerCase());if(Number.isFinite(Number(value))&&value>0){const next={...(index>=0?results[index]:{}),hotel:name,status:"AVAILABLE",rate:Number(value),currency,daysShifted:0,availableCheckIn:String((set as {criteria?:{checkIn?:string}})?.criteria?.checkIn??""),source:"Manual entry",sourceUrl:"",note:"Rate entered and saved by Master Admin.",manual:true,manualUpdatedAt:now};if(index>=0)results[index]=next;else results.push(next)}}
  const ownRate=Number.isFinite(Number(body.ourRate))&&Number(body.ourRate)>0?Number(body.ourRate):Number(current.ourRate)||null,mainKey=new Set(mainNames.map(name=>name.toLowerCase())),mainRates=results.filter(item=>mainKey.has(String(item.hotel??"").trim().toLowerCase())&&Number.isFinite(Number(item.rate))&&Number(item.rate)>0).map(item=>Number(item.rate)),marketMedian=mainRates.length?Math.round(median(mainRates)):null,occupancy=Number(current.occupancy)||null,occupancyFactor=occupancy!=null&&occupancy>=90?1.15:occupancy!=null&&occupancy>=76?1.10:occupancy!=null&&occupancy>=56?1.05:occupancy!=null&&occupancy<=30?.94:occupancy!=null&&occupancy<=45?.98:1,target=ownRate==null?null:marketMedian==null?ownRate*occupancyFactor:marketMedian*occupancyFactor,suggestedRate=target==null?null:Math.round(Math.min(ownRate!*1.12,Math.max(ownRate!*.88,target))),changePercent=ownRate&&suggestedRate!=null?Math.round((suggestedRate-ownRate)/ownRate*100):null,direction=changePercent==null?"Review":changePercent>0?"Increase":changePercent<0?"Reduce":"Hold";
  const analysis={...current,checkedAt:now,ourRate,ourRateSource:Number.isFinite(Number(body.ourRate))?"Manual entry":current.ourRateSource??null,marketMedian,summary:`${mainRates.length} of ${mainNames.length} Main competitor rates available.`,suggestedRate,reason:ownRate==null?"Add our current rate to calculate a recommendation.":marketMedian==null?"Add at least one competitor rate to calculate the market position.":`Based on the Main-set median of ${currency} ${marketMedian}${occupancy!=null?`, current occupancy of ${occupancy}%`:""} and a maximum 12% movement from our current rate.`,guide:suggestedRate==null?"Add the missing rates to complete the recommendation.":`${direction} to approximately ${currency} ${suggestedRate}${changePercent==null?"":` (${changePercent>0?"+":""}${changePercent}%)`}.`,confidence:ownRate!=null&&mainRates.length>=3?"HIGH":ownRate!=null&&mainRates.length>=2?"MEDIUM":"LOW",results};
  const payload:Record<string,unknown>={property_id:property.id,profile_data:{...profileData,competitorRateAnalysis:analysis},updated_by:user.id,updated_at:now};if(profile?.id)payload.id=profile.id;const {error:saveError}=await db.from("property_profiles").upsert(payload,{onConflict:"property_id"});if(saveError)throw saveError;
  return NextResponse.json({ok:true,analysis});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not save manual rates"},{status:500})}
}
