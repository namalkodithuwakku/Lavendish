import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL="https://otiiioaazkanroyzvlkg.supabase.co";
const SUPABASE_KEY="sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

export async function GET(request:NextRequest){
 const authorization=request.headers.get("authorization")??"";
 if(!authorization.startsWith("Bearer "))return NextResponse.json({success:false,error:"Authentication required"},{status:401});
 const userResponse=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_KEY,Authorization:authorization}});
 if(!userResponse.ok)return NextResponse.json({success:false,error:"Invalid session"},{status:401});
 const code=(request.nextUrl.searchParams.get("hotel")??"").toUpperCase();
 const year=request.nextUrl.searchParams.get("year")??String(new Date().getFullYear());
 const month=request.nextUrl.searchParams.get("month")??String(new Date().getMonth()+1);
 const isGroupRequest=request.nextUrl.searchParams.get("group")==="1";
 const forceFresh=request.nextUrl.searchParams.get("fresh")==="1";
 if(!/^[A-Z0-9]{2,6}$/.test(code)||!/^[0-9]{4}$/.test(year)||!/^([1-9]|1[0-2])$/.test(month))return NextResponse.json({success:false,error:"Invalid request"},{status:400});
 const profileResponse=await fetch(`${SUPABASE_URL}/rest/v1/occupancy_profiles?hotel_code=eq.${encodeURIComponent(code)}&select=hotel_code,hotel_name,google_spreadsheet_id,active_year_tab,status`,{headers:{apikey:SUPABASE_KEY,Authorization:authorization}});
 if(!profileResponse.ok)return NextResponse.json({success:false,error:"Hotel access denied"},{status:403});
 const profiles=await profileResponse.json() as Array<{hotel_code:string;hotel_name:string;google_spreadsheet_id:string|null;active_year_tab:string;status:string}>;
 const profile=profiles[0];
 if(!profile||profile.status!=="Active")return NextResponse.json({success:false,error:"Hotel is unavailable"},{status:404});
 if(!profile.google_spreadsheet_id)return NextResponse.json({success:false,error:"Google Sheet ID has not been added to this hotel profile"},{status:409});
 const scriptUrl=process.env.OCCUPANCY_SCRIPT_URL; const token=process.env.OCCUPANCY_API_TOKEN;
 if(!scriptUrl||!token)return NextResponse.json({success:false,error:"Sheet reader is not configured"},{status:503});
 const target=new URL(scriptUrl);target.searchParams.set("action","read");target.searchParams.set("token",token);target.searchParams.set("sheetId",profile.google_spreadsheet_id);target.searchParams.set("year",year);target.searchParams.set("month",month);
 try{const response=await fetch(target,{redirect:"follow",cache:isGroupRequest&&!forceFresh?"force-cache":"no-store",next:isGroupRequest&&!forceFresh?{revalidate:300}:undefined,signal:AbortSignal.timeout(isGroupRequest?45000:20000),headers:{Accept:"application/json"}});if(!response.ok)throw new Error(`Reader returned ${response.status}`);const data=await response.json() as {success?:boolean;error?:string};if(!data.success)return NextResponse.json(data,{status:502});return NextResponse.json(data,{headers:{"Cache-Control":"private, no-store"}})}catch(error){return NextResponse.json({success:false,error:error instanceof Error?error.message:"Sheet reader failed"},{status:502})}
}
