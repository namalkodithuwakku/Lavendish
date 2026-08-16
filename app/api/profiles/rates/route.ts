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
function addDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
function stayLength(checkIn:string,checkOut:string){return Math.max(1,Math.round((new Date(`${checkOut}T12:00:00Z`).getTime()-new Date(`${checkIn}T12:00:00Z`).getTime())/86400000))}
function emptyResult(hotel:string,criteria:Criteria,note:string,sourceUrl=""):RateResult{return {hotel,status:"NOT_VERIFIED",rate:null,currency:criteria.currency,requestedCheckIn:criteria.checkIn,availableCheckIn:"",availableCheckOut:"",daysShifted:0,datesChecked:`${criteria.checkIn} to ${addDays(criteria.checkIn,7)}`,room:"Lowest available double-occupancy room",mealPlan:"",cancellation:"",taxes:"unknown",source:"Google Hotels via SerpApi",sourceUrl,note}}
function cleanName(value:string){return value.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim()}
function nameScore(expected:string,actual:string){const left=cleanName(expected),right=cleanName(actual);if(left===right)return 1;if(left.includes(right)||right.includes(left))return .9;const words=left.split(" ").filter(word=>word.length>2),matched=words.filter(word=>right.includes(word)).length;const score=words.length?matched/words.length:0;return score>=.5?score:right.split(" ").filter(word=>word.length>2&&left.includes(word)).length/Math.max(1,right.split(" ").filter(word=>word.length>2).length)}
function safeGoogleTravelLink(name:string,checkIn:string,checkOut:string,currency:string){const params=new URLSearchParams({q:`${name} Sri Lanka hotel`,checkin:checkIn,checkout:checkOut,curr:currency});return `https://www.google.com/travel/search?${params.toString()}`}
type SerpRate={lowest?:string;extracted_lowest?:number;before_taxes_fees?:string;extracted_before_taxes_fees?:number};
type SerpOffer={source?:string;link?:string;rate_per_night?:SerpRate};
type SerpProperty={name?:string;type?:string;rate_per_night?:SerpRate;prices?:SerpOffer[]};
type SerpResponse={error?:string;properties?:SerpProperty[]};

async function searchCompetitor(apiKey:string,competitor:Competitor,criteria:Criteria,searchArea:string):Promise<RateResult>{
 const nights=stayLength(criteria.checkIn,criteria.checkOut),attemptErrors:string[]=[];
 for(let days=0;days<=7;days++){
  const checkIn=addDays(criteria.checkIn,days),checkOut=addDays(checkIn,nights),publicLink=safeGoogleTravelLink(competitor.name,checkIn,checkOut,criteria.currency),queries=[`${searchArea||"Sri Lanka"} hotels`,`${competitor.name} Sri Lanka hotel`];
  try{
   let property:SerpProperty|undefined,fatal=false;
   for(const query of queries){
    const params=new URLSearchParams({engine:"google_hotels",q:query,check_in_date:checkIn,check_out_date:checkOut,adults:"2",children:"0",currency:criteria.currency,gl:"lk",hl:"en",api_key:apiKey}),response=await fetch(`https://serpapi.com/search.json?${params.toString()}`,{cache:"no-store"}),payload=await response.json() as SerpResponse;
    if(!response.ok||payload.error){attemptErrors.push(`${checkIn}: ${payload.error||`HTTP ${response.status}`}`);fatal=response.status===401||response.status===403||response.status===429;if(fatal)break;continue}
    const candidates=(payload.properties??[]).map(item=>({property:item,score:nameScore(competitor.name,item.name??"")})).filter(item=>item.score>=.55).sort((a,b)=>b.score-a.score);
    property=candidates[0]?.property;if(property)break;
   }
   if(fatal)break;
   if(!property){attemptErrors.push(`${checkIn}: hotel not matched in destination or exact-name results`);continue}
   const offers=property.prices??[],booking=offers.find(offer=>(offer.source??"").toLowerCase().includes("booking.com")),lowestOffer=offers.filter(offer=>Number.isFinite(offer.rate_per_night?.extracted_lowest)).sort((a,b)=>(a.rate_per_night?.extracted_lowest??Infinity)-(b.rate_per_night?.extracted_lowest??Infinity))[0],selected=booking?.rate_per_night?.extracted_lowest!=null?booking:lowestOffer,rate=selected?.rate_per_night?.extracted_lowest??property.rate_per_night?.extracted_lowest;
   if(rate==null||!Number.isFinite(rate)){attemptErrors.push(`${checkIn}: property found but no nightly rate returned`);continue}
   const source=selected?.source||"Google Hotels",sourceUrl=selected?.link&&!selected.link.includes("api_key=")?selected.link:publicLink;
   return {hotel:competitor.name,status:days===0?"AVAILABLE":"FALLBACK_DATE",rate:Number(rate),currency:criteria.currency,requestedCheckIn:criteria.checkIn,availableCheckIn:checkIn,availableCheckOut:checkOut,daysShifted:days,datesChecked:`${criteria.checkIn} to ${checkIn}`,room:"Lowest available double-occupancy room",mealPlan:"Not specified by Google Hotels",cancellation:"Check provider terms",taxes:selected?.rate_per_night?.before_taxes_fees?"May exclude taxes and fees":"unknown",source,sourceUrl,note:`Date-specific Google Hotels rate for 1 room and 2 adults${source.toLowerCase().includes("booking.com")?"; Booking.com offer selected":""}.`}
  }catch(error){attemptErrors.push(`${checkIn}: ${error instanceof Error?error.message:"request failed"}`)}
 }
 return emptyResult(competitor.name,criteria,attemptErrors.slice(-3).join(" · ")||"No rate returned for the requested or next seven arrival dates.",safeGoogleTravelLink(competitor.name,criteria.checkIn,criteria.checkOut,criteria.currency));
}

export async function POST(request:NextRequest){
 try{
  const user=await requireMaster(request);if(!user)return NextResponse.json({error:"Master Admin access required"},{status:403});
  const serpApiKey=process.env.SERPAPI_API_KEY;if(!serpApiKey)throw new Error("SERPAPI_API_KEY is not configured in Vercel");
  const body=await request.json() as {propertyId?:string;criteria?:Criteria;competitors?:Competitor[]};
  if(!body.propertyId||!body.criteria?.checkIn||!body.criteria?.checkOut)return NextResponse.json({error:"Hotel and stay dates are required"},{status:400});
  const competitors=(body.competitors??[]).filter(item=>item.active&&item.name.trim()).slice(0,7);if(!competitors.length)return NextResponse.json({error:"Add at least one active competitor"},{status:400});
  const criteria={...body.criteria,rooms:"1",adults:"2",children:"0",childAges:"",roomType:"Lowest available double occupancy"},db=adminClient();const {data:property,error}=await db.from("properties").select("id,name,location,legacy_hotel_code").eq("id",body.propertyId).single();if(error||!property)throw error??new Error("Property not found");
  const {data:snapshot}=property.legacy_hotel_code?await db.from("yield_occupancy_snapshots").select("rooms_sold,total_rooms,occupancy_percent,last_checked_at").eq("hotel_code",property.legacy_hotel_code).eq("stay_date",criteria.checkIn).maybeSingle():{data:null};
  const searchArea=property.location||"Sri Lanka",ourRateResult=await searchCompetitor(serpApiKey,{name:property.name,url:"",active:true},criteria,searchArea),results:RateResult[]=[];for(const competitor of competitors)results.push(await searchCompetitor(serpApiKey,competitor,criteria,searchArea));
  const exactRates=results.filter(result=>result.rate!=null&&result.daysShifted===0).map(result=>result.rate as number).sort((a,b)=>a-b),allRates=results.filter(result=>result.rate!=null).map(result=>result.rate as number).sort((a,b)=>a-b),marketRates=exactRates.length>=2?exactRates:allRates,marketMedian=marketRates.length?marketRates[Math.floor(marketRates.length/2)]:null,occupancy=Number(snapshot?.occupancy_percent??0),liveOurRate=ourRateResult.rate??(Number(criteria.ourRate)>0?Number(criteria.ourRate):null),occupancyFactor=occupancy>=90?1.15:occupancy>=76?1.10:occupancy>=56?1.05:occupancy>0&&occupancy<=30?.94:occupancy>30&&occupancy<=45?.98:1,marketTarget=marketMedian==null?liveOurRate==null?null:liveOurRate*occupancyFactor:marketMedian*occupancyFactor,lowerLimit=liveOurRate==null?null:liveOurRate*.88,upperLimit=liveOurRate==null?null:liveOurRate*1.12,suggestedRate=marketTarget==null?null:Math.round(lowerLimit==null||upperLimit==null?marketTarget:Math.min(upperLimit,Math.max(lowerLimit,marketTarget))),changePercent=liveOurRate&&suggestedRate!=null?Math.round((suggestedRate-liveOurRate)/liveOurRate*100):null;
  const fallbackCount=results.filter(result=>result.status==="FALLBACK_DATE").length,failedCount=results.filter(result=>result.rate==null).length,verifiedCount=allRates.length,direction=changePercent==null?"review":changePercent>0?"increase":changePercent<0?"reduce":"hold";
  const analysis={checkedAt:new Date().toISOString(),ourRate:liveOurRate,ourRateStatus:ourRateResult.status,ourRateSource:ourRateResult.source,ourRateSourceUrl:ourRateResult.sourceUrl,marketMedian,occupancy:occupancy||null,summary:`Our live rate ${liveOurRate==null?"was not found":`is ${criteria.currency} ${liveOurRate}`}; ${verifiedCount} of ${competitors.length} competitor rates verified${fallbackCount?`; ${fallbackCount} found on later dates`:""}.`,suggestedRate,reason:marketMedian==null?"Insufficient competitor evidence; the recommendation is limited to our current rate and occupancy position.":`Uses the market median of ${criteria.currency} ${marketMedian}, ${occupancy?`${occupancy}% occupancy`:"available demand evidence"}, exact-date rates where possible, and a maximum 12% movement from our current rate. The lowest competitor rate is not used as the target.`,guide:suggestedRate==null?"Complete a manual market check before changing rates.":`${direction==="hold"?"Hold":direction==="increase"?"Increase":"Reduce"} the public rate to approximately ${criteria.currency} ${suggestedRate}${changePercent==null?"":` (${changePercent>0?"+":""}${changePercent}%)`}. ${failedCount?"Some competitor rates were unavailable; review their Google Hotels links before applying.":"Verify taxes and cancellation terms before updating channels."}`,confidence:exactRates.length>=4&&liveOurRate!=null?"HIGH":verifiedCount>=2&&liveOurRate!=null?"MEDIUM":"LOW",results};
  const {data:savedProfile,error:profileReadError}=await db.from("property_profiles").select("id,profile_data").eq("property_id",property.id).maybeSingle();if(profileReadError)throw profileReadError;
  const savedData=savedProfile?.profile_data&&typeof savedProfile.profile_data==="object"?savedProfile.profile_data as Record<string,unknown>:{},profilePayload:Record<string,unknown>={property_id:property.id,profile_data:{...savedData,competitorRateAnalysis:analysis},updated_by:user.id,updated_at:new Date().toISOString()};if(savedProfile?.id)profilePayload.id=savedProfile.id;
  const {error:profileSaveError}=await db.from("property_profiles").upsert(profilePayload,{onConflict:"property_id"});if(profileSaveError)throw profileSaveError;
  await db.from("intelligence_runs").insert({module:"YIELD",run_type:"MANUAL",status:"COMPLETED",requested_by:user.id,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),result_summary:{propertyId:property.id,checkIn:criteria.checkIn,checkOut:criteria.checkOut,competitorCount:competitors.length,verifiedRateCount:verifiedCount,fallbackCount,advisoryOnly:true}});
  return NextResponse.json({ok:true,analysis});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not complete rate comparison"},{status:500})}
}
