import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://otiiioaazkanroyzvlkg.supabase.co";
const supabasePublishableKey = "sb_publishable_zMueiaaAsayg8y1fOBazLg_MauoW5hY";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
