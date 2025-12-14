import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";

// Cliente normal (publishable/public) — usado por el frontend o para lecturas públicas
export const supabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

// Cliente administrador (secret key) — SIEMPRE inicializado, tiene permisos de admin
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);
