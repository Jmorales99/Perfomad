import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";

// Cliente normal (anon) — usado por el frontend o para lecturas públicas
export const supabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

// Cliente administrador (server-side) — SIEMPRE inicializado
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
