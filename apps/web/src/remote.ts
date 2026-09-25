import { createHttpRemote } from "./httpRemote";
import { createSupabaseRemote, resolveSupabaseUrl } from "./supabaseRemote";

export const usingSupabase = Boolean(resolveSupabaseUrl(import.meta.env.VITE_SUPABASE_URL) && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const remote = usingSupabase ? createSupabaseRemote() : createHttpRemote();
