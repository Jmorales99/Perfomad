import { z } from "zod";
import dotenv from "dotenv";

// Cargar variables del .env
dotenv.config();

// Validamos las variables de entorno
export const env = z
  .object({
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    PORT: z.coerce.number().default(3000), // 👈 ahora sí validamos y asignamos el puerto
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  })
  .parse(process.env);

// Bandera global
export const isProd = env.NODE_ENV === "production";
