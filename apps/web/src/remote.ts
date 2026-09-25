import { createHttpRemote } from "./httpRemote";
import { createSupabaseRemote } from "./supabaseRemote";

export const usingSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const remote = usingSupabase ? createSupabaseRemote() : createHttpRemote();
