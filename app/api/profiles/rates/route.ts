import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic="force-dynamic";
export const maxDuration=180;

const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";
type Competitor={name:string;url:string;active:boolean};
type Criteria={checkIn:string;checkOut:string;rooms:string;adults:string;children:string;childAges:string;mealPlan:string;roomType:string;cancellation:string;currency:string;source:string;ourRate:string};

function adminClient(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function requireMaster(request:NextRequest){const authorization=request.headers.get("authorization")??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";if(!token)return null;const auth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const {data:{user}}=await auth.auth.getUser(token);if(!user)return null;const {data}=await adminClient().from("occupancy_user_access").select("role,active").eq("user_id",user.id).maybeSingle();return data?.active&&data.role==="MASTER_ADMIN"?user:null}
function outputText(response:{output?:Array<{content?:Array<{type?:string;text?:string}>}>}){return (response.output??[]).flatMap(item=>item.content??[]).filter(item=>item.type==="output_text").map(item=>item.text??"").join("\n")}
function parseJson(text:string){return JSON.parse(text.replace(/^```json\s*/i,"").replace(/\s*```$/i,"").trim()) as Record<string,unknown>}

export async function POST(request:NextRequest){
 const user=await requireMaster(request);if(!user)return NextResponse.json({error:"Master Admin access required"},{status:403});
 try{
  const apiKey=process.env.OPENAI_API_KEY;if(!apiKey)throw new Error("OPENAI_API_KEY is not configured in Vercel");
  const body=await request.json() as {propertyId?:string;criteria?:Criteria;competitors?:Competitor[]};
  if(!body.propertyId||!body.criteria?.checkIn||!body.criteria?.checkOut)return NextResponse.json({error:"Hotel and stay dates are required"},{status:400});
  const competitors=(body.competitors??[]).filter(item=>item.active&&item.name.trim()).slice(0,7);if(!competitors.length)return NextResponse.json({error:"Add at least one active competitor"},{status:400});
  const db=adminClient();const {data:property,error}=await db.from("properties").select("id,name,location,legacy_hotel_code").eq("id",body.propertyId).single();if(error||!property)throw error??new Error("Property not found");
  const {data:snapshot}=property.legacy_hotel_code?await db.from("yield_occupancy_snapshots").select("rooms_sold,total_rooms,occupancy_percent,last_checked_at").eq("hotel_code",property.legacy_hotel_code).eq("stay_date",body.criteria.checkIn).maybeSingle():{data:null};
  const prompt=`Act as the NKH hotel revenue analyst. Use web search to check public rates for the exact requested stay. Never invent or estimate a hotel rate. Mark it UNAVAILABLE when no bookable rate can be verified. Compare like with like and state material room, meal-plan, tax and cancellation differences.

Our hotel: ${property.name}, ${property.location??""}
Stay criteria: ${JSON.stringify(body.criteria)}
Known occupancy for arrival date: ${JSON.stringify(snapshot??{status:"not available"})}
Competitors: ${competitors.map((item,index)=>`${index+1}. ${item.name} ${item.url||""}`).join("\n")}

Return ONLY valid JSON with this structure:
{"checkedAt":"ISO time","summary":"short operational summary","suggestedRate":number|null,"reason":"concise evidence-based reason","guide":"specific manual rate/channel action","confidence":"HIGH|MEDIUM|LOW","results":[{"hotel":"name","status":"AVAILABLE|UNAVAILABLE|NOT_VERIFIED","rate":number|null,"currency":"code","room":"room name or blank","mealPlan":"plan or blank","cancellation":"terms or blank","taxes":"included/excluded/unknown","source":"source name","sourceUrl":"direct public URL","note":"short comparability note"}]}
The suggested rate must use the requested currency, our current rate, verified comparable rates and known occupancy. If evidence is insufficient, suggestedRate must be null and the guide must request a manual check. This is advisory only; do not claim any OTA was updated.`;
  const ai=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_RATE_MODEL||process.env.OPENAI_PROFILE_MODEL||"gpt-5.4-mini",tools:[{type:"web_search"}],input:prompt,max_output_tokens:5000})});
  if(!ai.ok){const detail=await ai.text();throw new Error(`OpenAI rate search failed (${ai.status}): ${detail.slice(0,180)}`)}
  const response=await ai.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};const analysis=parseJson(outputText(response));
  await db.from("intelligence_runs").insert({module:"YIELD",run_type:"MANUAL",status:"COMPLETED",requested_by:user.id,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),result_summary:{propertyId:property.id,checkIn:body.criteria.checkIn,checkOut:body.criteria.checkOut,competitorCount:competitors.length,advisoryOnly:true}});
  return NextResponse.json({ok:true,analysis});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not complete rate comparison"},{status:500})}
}
