import { createClient } from "@supabase/supabase-js";
import { NextRequest,NextResponse } from "next/server";

export const dynamic="force-dynamic";
export const maxDuration=300;

const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

function db(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function dateInColombo(offset=0){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),map=Object.fromEntries(parts.map(item=>[item.type,item.value])),date=new Date(`${map.year}-${map.month}-${map.day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10)}
function cronAuthorized(request:NextRequest){const header=request.headers.get("authorization")??"",secrets=[process.env.CRON_SECRET,process.env.YIELD_CRON_SECRET].filter(Boolean);return secrets.some(secret=>header===`Bearer ${secret}`)}
async function masterAuthorized(request:NextRequest){const header=request.headers.get("authorization")??"",token=header.startsWith("Bearer ")?header.slice(7):"";if(!token)return false;const auth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),{data:{user}}=await auth.auth.getUser(token);if(!user)return false;const {data}=await db().from("occupancy_user_access").select("role,active").eq("user_id",user.id).maybeSingle();return data?.active===true&&data.role==="MASTER_ADMIN"}

async function runChecks(request:NextRequest){
 const client=db(),{data,error}=await client.from("properties").select("id,name,property_profiles(profile_data)").order("name");if(error)throw error;
 const checkIn=dateInColombo(),checkOut=dateInColombo(1),jobs=(data??[]).flatMap(property=>{const relation=property.property_profiles as unknown,profiles=Array.isArray(relation)?relation:relation?[relation]:[],profile=profiles[0] as {profile_data?:Record<string,unknown>}|undefined,profileData=profile?.profile_data??{},set=profileData.competitorSet as {main?:Array<{name:string;url:string;active:boolean}>;criteria?:Record<string,string>}|undefined,competitors=(set?.main??[]).filter(item=>item.active&&item.name?.trim()).slice(0,4);return competitors.length?[{propertyId:property.id,name:property.name,competitors,criteria:{...(set?.criteria??{}),checkIn,checkOut,rooms:"1",adults:"2",children:"0",childAges:"",roomType:"Lowest available double occupancy",currency:set?.criteria?.currency||"USD",source:"Booking.com"}}]:[]});
 const results:Array<{hotel:string;ok:boolean;message?:string}>=[];let cursor=0;
 async function worker(){while(cursor<jobs.length){const job=jobs[cursor++];try{const response=await fetch(new URL("/api/profiles/rates",request.nextUrl.origin),{method:"POST",headers:{"Content-Type":"application/json",Authorization:request.headers.get("authorization")??""},body:JSON.stringify(job),cache:"no-store"}),payload=await response.json() as {error?:string};results.push({hotel:job.name,ok:response.ok,message:payload.error})}catch(error){results.push({hotel:job.name,ok:false,message:error instanceof Error?error.message:"Check failed"})}}}
 await Promise.all(Array.from({length:Math.min(2,jobs.length)},()=>worker()));
 return {ok:results.every(item=>item.ok),checkedAt:new Date().toISOString(),schedule:"06:00, 11:00, 15:00 Asia/Colombo",hotels:results.length,succeeded:results.filter(item=>item.ok).length,failed:results.filter(item=>!item.ok).length,results};
}

export async function GET(request:NextRequest){if(!cronAuthorized(request))return NextResponse.json({error:"Cron authorization required"},{status:401});try{return NextResponse.json(await runChecks(request))}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Scheduled Comp Set check failed"},{status:500})}}
export async function POST(request:NextRequest){if(!(await masterAuthorized(request)))return NextResponse.json({error:"Master Admin access required"},{status:403});try{return NextResponse.json(await runChecks(request))}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Portfolio Comp Set check failed"},{status:500})}}
