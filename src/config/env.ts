import { z } from "zod";
import dotenv from "dotenv";

// Cargar variables del .env
dotenv.config();

// Validamos las variables de entorno
// Supabase now uses: Publishable Key (public) and Secret Key (private)
// Support both old and new naming for backward compatibility
export const env = z
  .object({
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    SUPABASE_URL: z.string().url(),
    // New names (Publishable = public, Secret = private/admin)
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    // Old names (for backward compatibility)
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    // Plai API Configuration
    PLAI_API_URL: z.string().url().optional(), // Production Plai API URL
    PLAI_API_KEY: z.string().min(1).optional(), // Production Plai API Key
    // Mock API (for development)
    MOCK_API_URL: z.string().url().optional(), // Mock API URL (dev only)
    MOCK_API_KEY: z.string().min(1).optional(), // Mock API Key (dev only)
    // CORS allowed origin (frontend URL)
    FRONTEND_URL: z.string().url().optional(),
  })
  .transform((data) => ({
    ...data,
    // Use new names if provided, fallback to old names
    SUPABASE_PUBLISHABLE_KEY: data.SUPABASE_PUBLISHABLE_KEY || data.SUPABASE_ANON_KEY || "",
    SUPABASE_SECRET_KEY: data.SUPABASE_SECRET_KEY || data.SUPABASE_SERVICE_ROLE_KEY || "",
  }))
  .refine(
    (data) => data.SUPABASE_PUBLISHABLE_KEY && data.SUPABASE_SECRET_KEY,
    {
      message: "Either SUPABASE_PUBLISHABLE_KEY/SUPABASE_SECRET_KEY or SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY must be provided",
    }
  )
  .parse(process.env);

// Bandera global
export const isProd = env.NODE_ENV === "production";
