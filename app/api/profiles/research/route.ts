import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic="force-dynamic";
export const maxDuration=180;

const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

function adminClient(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function requireMaster(request:NextRequest){const authorization=request.headers.get("authorization")??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";if(!token)return null;const auth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const {data:{user}}=await auth.auth.getUser(token);if(!user)return null;const {data}=await adminClient().from("occupancy_user_access").select("role,active").eq("user_id",user.id).maybeSingle();return data?.active&&data.role==="MASTER_ADMIN"?user:null}
function outputText(response:{output?:Array<{content?:Array<{type?:string;text?:string}>}>}){return (response.output??[]).flatMap(item=>item.content??[]).filter(item=>item.type==="output_text").map(item=>item.text??"").join("\n")}
function parseJson(text:string){const cleaned=text.replace(/^```json\s*/i,"").replace(/\s*```$/i,"").trim();return JSON.parse(cleaned) as Record<string,unknown>}
function mergeResearchDraft(current:Record<string,unknown>,draft:Record<string,unknown>,sections:string[]){
 const merged:Record<string,unknown>={...current};
 for(const section of sections){
  const existing=current[section]&&typeof current[section]==="object"&&!Array.isArray(current[section])?current[section] as Record<string,unknown>:{};
  const researched=draft[section]&&typeof draft[section]==="object"&&!Array.isArray(draft[section])?draft[section] as Record<string,unknown>:{};
  const sectionData:Record<string,unknown>={...researched};
  for(const [key,value] of Object.entries(existing)){if(String(value??"").trim())sectionData[key]=value}
  merged[section]=sectionData;
 }
 merged.internal=current.internal??{};
 return merged;
}

export async function POST(request:NextRequest){
 const user=await requireMaster(request);if(!user)return NextResponse.json({error:"Master Admin access required"},{status:403});
 try{
  const apiKey=process.env.OPENAI_API_KEY;if(!apiKey)throw new Error("OPENAI_API_KEY is not configured in Vercel");
  const {propertyId}=await request.json() as {propertyId?:string};if(!propertyId)return NextResponse.json({error:"Property is required"},{status:400});
  const db=adminClient();
  const {data:property,error}=await db.from("properties").select("id,name,location,legacy_hotel_code,property_profiles(id,profile_data),property_profile_sources(id,source_type,label,source_url)").eq("id",propertyId).single();if(error||!property)throw error??new Error("Property not found");
  const profile=property.property_profiles?.[0],sources=(property.property_profile_sources??[]).filter((item:{source_url?:string|null})=>item.source_url);
  if(!sources.length)return NextResponse.json({error:"Add at least one approved source first"},{status:400});
  const sectionNames=["identity","location","operations","rooms","facilities","dining","policies","contacts","channels","brandKit","marketingProfile","reputation","assets"];
  const prompt=`Research a hotel profile for NKH Performance Hub. Hotel: ${property.name}; location: ${property.location??"unknown"}; code: ${property.legacy_hotel_code??"unknown"}.
Approved starting sources: ${sources.map((item:{source_type:string;label:string|null;source_url:string})=>`${item.source_type}: ${item.label??""} ${item.source_url}`).join("\n")}
Current editable profile: ${JSON.stringify(profile?.profile_data??{})}

Return ONLY one valid JSON object with these top-level sections: ${sectionNames.join(", ")}.
Each section must be an object containing short string values. Use newline-separated strings for lists. Preserve every non-empty current value exactly. Fill only information supported by reliable public sources. Never invent rates, room counts, policies, contacts, facilities or classifications. Leave uncertain fields as empty strings. Do not include citations inside field values. Never add or change the internal section. This is a draft for human approval, not publishable content.`;
  const aiResponse=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_PROFILE_MODEL||"gpt-5.4-mini",tools:[{type:"web_search"}],input:prompt,max_output_tokens:7000})});
  if(!aiResponse.ok){const detail=await aiResponse.text();throw new Error(`OpenAI research failed (${aiResponse.status}): ${detail.slice(0,180)}`)}
  const response=await aiResponse.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};const draft=parseJson(outputText(response));
  const current=(profile?.profile_data??{}) as Record<string,unknown>;const merged=mergeResearchDraft(current,draft,sectionNames);
  const values=sectionNames.flatMap(section=>Object.values((merged[section]&&typeof merged[section]==="object"?merged[section]:{}) as Record<string,unknown>)).map(String);const completion=Math.min(100,Math.round(values.filter(value=>value.trim()).length/103*100));
  const {error:updateError}=await db.from("property_profiles").upsert({id:profile?.id,property_id:property.id,profile_data:merged,completion_percent:completion,verification_status:"NEEDS_REVIEW",marketing_readiness:completion>=80?"READY":completion>=40?"PARTIAL":"NOT_READY",last_ai_scan_at:new Date().toISOString(),updated_by:user.id,updated_at:new Date().toISOString()},{onConflict:"property_id"});if(updateError)throw updateError;
  await db.from("property_profile_sources").update({scan_status:"READY",last_scanned_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("property_id",property.id);
  await db.from("intelligence_runs").insert({module:"PROFILE",run_type:"MANUAL",status:"COMPLETED",requested_by:user.id,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),result_summary:{propertyId:property.id,propertyName:property.name,sourceCount:sources.length,requiresApproval:true}});
  return NextResponse.json({ok:true,completion});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not research profile"},{status:500})}
}
