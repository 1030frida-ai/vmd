import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = !!(url && key);
export const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || "vmd-images";
export const supabase = hasSupabase ? createClient(url, key) : null;
