import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic="force-dynamic";
export const maxDuration=300;

const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";
type Competitor={name:string;url:string;active:boolean};
type Criteria={checkIn:string;checkOut:string;rooms:string;adults:string;children:string;childAges:string;mealPlan:string;roomType:string;cancellation:string;currency:string;source:string;ourRate:string};
type RateResult={hotel:string;status:"AVAILABLE"|"FALLBACK_DATE"|"UNAVAILABLE"|"NOT_VERIFIED";rate:number|null;currency:string;requestedCheckIn:string;availableCheckIn:string;availableCheckOut:string;daysShifted:number;datesChecked:string;room:string;mealPlan:string;cancellation:string;taxes:string;source:string;sourceUrl:string;note:string};

function adminClient(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.SUPABASE_SECRET_KEY;if(!key)throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");return createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function requireMaster(request:NextRequest){const authorization=request.headers.get("authorization")??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";if(!token)return null;const auth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const {data:{user}}=await auth.auth.getUser(token);if(!user)return null;const {data}=await adminClient().from("occupancy_user_access").select("role,active").eq("user_id",user.id).maybeSingle();return data?.active&&data.role==="MASTER_ADMIN"?user:null}
function outputText(response:{output?:Array<{content?:Array<{type?:string;text?:string}>}>}){return (response.output??[]).flatMap(item=>item.content??[]).filter(item=>item.type==="output_text").map(item=>item.text??"").join("\n")}
function parseJson(text:string){return JSON.parse(text.replace(/^\`\`\`json\s*/i,"").replace(/\s*\`\`\`$/i,"").trim()) as Record<string,unknown>}
function addDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
function stayLength(checkIn:string,checkOut:string){return Math.max(1,Math.round((new Date(`${checkOut}T12:00:00Z`).getTime()-new Date(`${checkIn}T12:00:00Z`).getTime())/86400000))}
function emptyResult(hotel:string,criteria:Criteria,note:string):RateResult{return {hotel,status:"NOT_VERIFIED",rate:null,currency:criteria.currency,requestedCheckIn:criteria.checkIn,availableCheckIn:"",availableCheckOut:"",daysShifted:0,datesChecked:`${criteria.checkIn} to ${addDays(criteria.checkIn,7)}`,room:"",mealPlan:"",cancellation:"",taxes:"unknown",source:"OpenAI web search",sourceUrl:"",note}}
function normalizeResult(value:Record<string,unknown>,hotel:string,criteria:Criteria):RateResult{const candidateRate=typeof value.rate==="number"&&Number.isFinite(value.rate)?value.rate:null,availableCheckIn=String(value.availableCheckIn||""),availableCheckOut=String(value.availableCheckOut||""),sourceUrl=String(value.sourceUrl||""),nights=stayLength(criteria.checkIn,criteria.checkOut),dayDifference=availableCheckIn?Math.round((new Date(`${availableCheckIn}T12:00:00Z`).getTime()-new Date(`${criteria.checkIn}T12:00:00Z`).getTime())/86400000):-1,validDates=dayDifference>=0&&dayDifference<=7&&availableCheckOut===addDays(criteria.checkIn,dayDifference+nights),claimedStatus=String(value.status),validStatus=dayDifference===0?claimedStatus==="AVAILABLE":dayDifference>0?claimedStatus==="FALLBACK_DATE":false,verified=candidateRate!=null&&validDates&&validStatus&&Boolean(sourceUrl);if(!verified){const explanation=String(value.note||"Displayed price was not tied to the requested or permitted fallback stay dates.");return {hotel,status:claimedStatus==="UNAVAILABLE"?"UNAVAILABLE":"NOT_VERIFIED",rate:null,currency:criteria.currency,requestedCheckIn:criteria.checkIn,availableCheckIn:"",availableCheckOut:"",daysShifted:0,datesChecked:String(value.datesChecked||`${criteria.checkIn} to ${addDays(criteria.checkIn,7)}`),room:"",mealPlan:"",cancellation:"",taxes:String(value.taxes||"unknown"),source:String(value.source||"OpenAI web search"),sourceUrl,note:`${explanation} Any untied indicative price was excluded.`}}return {hotel,status:dayDifference===0?"AVAILABLE":"FALLBACK_DATE",rate:candidateRate,currency:String(value.currency||criteria.currency),requestedCheckIn:criteria.checkIn,availableCheckIn,availableCheckOut,daysShifted:dayDifference,datesChecked:String(value.datesChecked||availableCheckIn),room:String(value.room||""),mealPlan:String(value.mealPlan||""),cancellation:String(value.cancellation||""),taxes:String(value.taxes||"unknown"),source:String(value.source||"OpenAI web search"),sourceUrl,note:String(value.note||"")}}

async function searchCompetitor(apiKey:string,model:string,competitor:Competitor,criteria:Criteria):Promise<RateResult>{
 const nights=stayLength(criteria.checkIn,criteria.checkOut),dates=Array.from({length:8},(_,days)=>({days,checkIn:addDays(criteria.checkIn,days),checkOut:addDays(criteria.checkIn,days+nights)}));
 const prompt=`Find a currently bookable public hotel rate using fresh web search.

Hotel: ${competitor.name}
Starting source: ${competitor.url||"Search Google Hotels, the official hotel site, Booking.com, Agoda and Expedia"}
Rate basis: the lowest publicly bookable nightly rate for exactly 1 room and 2 adults, with no children. Room category does not need to match; accept whichever room category has the lowest available double-occupancy price. Do not use single-occupancy, family, triple, suite-only, package-total or per-person prices.
Requested meal plan: ${criteria.mealPlan}
Cancellation preference: ${criteria.cancellation}
Currency: ${criteria.currency}
Preferred rate channel: ${criteria.source||"Booking.com"}
Dates to check in this exact order: ${dates.map(item=>`${item.checkIn} to ${item.checkOut}`).join(", ")}

Search ${criteria.source||"Booking.com"} first for every date. Use Google Hotels, the official site or another major OTA only when the preferred channel has no visible verifiable rate, and clearly name the source used. Search the requested date first. If unavailable or no verifiable price is visible, search the next date, continuing up to the eighth listed arrival date. Stop at the first rate whose hotel, dates and guest details can be tied to a public source. Search this hotel independently; do not discuss or return other hotels. Never invent or convert a price. A visible Google Hotels or OTA search-result price is acceptable ONLY when the public evidence ties it to the same check-in, check-out, one-room and two-adult occupancy. If a price is visible but its dates or guest details cannot be verified, set rate:null, leave availableCheckIn and availableCheckOut blank, and use NOT_VERIFIED. Never place an indicative, from-price, cached snippet price or unrelated-date price in the rate field. Return a result even when every search fails.

Return ONLY valid JSON:
{"hotel":"exact supplied hotel","status":"AVAILABLE|FALLBACK_DATE|UNAVAILABLE|NOT_VERIFIED","rate":number|null,"currency":"${criteria.currency}","availableCheckIn":"YYYY-MM-DD or blank","availableCheckOut":"YYYY-MM-DD or blank","daysShifted":0,"datesChecked":"first to last date checked","room":"room or blank","mealPlan":"plan or blank","cancellation":"terms or blank","taxes":"included|excluded|unknown","source":"Google Hotels, OTA or official site","sourceUrl":"direct result URL or blank","note":"short evidence or failure reason"}
Use AVAILABLE only for the original date and FALLBACK_DATE for a later date.`;
 try{
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,tools:[{type:"web_search",search_context_size:"medium"}],tool_choice:"required",reasoning:{effort:"none"},input:prompt,max_output_tokens:1800})});
  if(!response.ok){const detail=await response.text();return emptyResult(competitor.name,criteria,`OpenAI search failed (${response.status}): ${detail.slice(0,160)}`)}
  const payload=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
  const text=outputText(payload);if(!text)return emptyResult(competitor.name,criteria,"OpenAI completed without a readable search result.");
  return normalizeResult(parseJson(text),competitor.name,criteria);
 }catch(error){return emptyResult(competitor.name,criteria,error instanceof Error?error.message:"Competitor search failed.")}
}

export async function POST(request:NextRequest){
 try{
  const user=await requireMaster(request);if(!user)return NextResponse.json({error:"Master Admin access required"},{status:403});
  const apiKey=process.env.OPENAI_API_KEY??process.env.OPENAI_API_TOKEN;if(!apiKey)throw new Error("OPENAI_API_KEY is not configured in Vercel");
  const body=await request.json() as {propertyId?:string;criteria?:Criteria;competitors?:Competitor[]};
  if(!body.propertyId||!body.criteria?.checkIn||!body.criteria?.checkOut)return NextResponse.json({error:"Hotel and stay dates are required"},{status:400});
  const competitors=(body.competitors??[]).filter(item=>item.active&&item.name.trim()).slice(0,7);if(!competitors.length)return NextResponse.json({error:"Add at least one active competitor"},{status:400});
  const criteria={...body.criteria,rooms:"1",adults:"2",children:"0",childAges:"",roomType:"Lowest available double occupancy"},db=adminClient();const {data:property,error}=await db.from("properties").select("id,name,location,legacy_hotel_code").eq("id",body.propertyId).single();if(error||!property)throw error??new Error("Property not found");
  const {data:snapshot}=property.legacy_hotel_code?await db.from("yield_occupancy_snapshots").select("rooms_sold,total_rooms,occupancy_percent,last_checked_at").eq("hotel_code",property.legacy_hotel_code).eq("stay_date",criteria.checkIn).maybeSingle():{data:null};
  const model=process.env.OPENAI_RATE_MODEL||"gpt-5.4-mini";
  const results:RateResult[]=[];for(const competitor of competitors)results.push(await searchCompetitor(apiKey,model,competitor,criteria));
  const verified=results.filter(result=>result.rate!=null).map(result=>result.rate as number).sort((a,b)=>a-b),median=verified.length?verified[Math.floor(verified.length/2)]:null,occupancy=Number(snapshot?.occupancy_percent??0),factor=occupancy>=80?1.05:occupancy>0&&occupancy<=35?.95:1,suggestedRate=median==null?null:Math.round(median*factor);
  const fallbackCount=results.filter(result=>result.status==="FALLBACK_DATE").length,failedCount=results.filter(result=>result.rate==null).length;
  const analysis={checkedAt:new Date().toISOString(),summary:`${verified.length} of ${competitors.length} competitor rates verified${fallbackCount?`; ${fallbackCount} found on later dates`:""}.`,suggestedRate,reason:median==null?"No publicly verifiable comparable rates were found.":`Based on the median verified competitor rate${occupancy?` and ${occupancy}% occupancy`:""}.`,guide:failedCount?"Review the unavailable hotels using their source links; do not treat missing rates as sold out.":"Verify room, meal-plan, cancellation and tax parity before updating channels.",confidence:verified.length>=4?"HIGH":verified.length>=2?"MEDIUM":"LOW",results};
  await db.from("intelligence_runs").insert({module:"YIELD",run_type:"MANUAL",status:"COMPLETED",requested_by:user.id,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),result_summary:{propertyId:property.id,checkIn:criteria.checkIn,checkOut:criteria.checkOut,competitorCount:competitors.length,verifiedRateCount:verified.length,fallbackCount,advisoryOnly:true}});
  return NextResponse.json({ok:true,analysis});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not complete rate comparison"},{status:500})}
}
