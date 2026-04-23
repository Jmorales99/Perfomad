// TEMPORARY TEST: Try using regular client instead of admin
// Run from repo root: npx tsx scripts/debug/SupabaseUserRepository_TEST.ts
import { supabaseClient } from "../../src/infrastructure/db/supabaseClient.js"
import { isProd } from "../../src/config/env.js"

/**
 * TEMPORARY TEST FUNCTION
 * Try creating user with regular client to see if admin client is the issue
 */
export async function testCreateUser(email: string, password: string) {
  try {
    console.log("🧪 Testing with regular client...")
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: "http://localhost:5173/auth",
      },
    })

    if (error) {
      console.error("❌ Error with regular client:", error)
      return { error: error.message }
    }

    console.log("✅ Success with regular client:", data.user?.id)
    return { user: data.user }
  } catch (err: any) {
    console.error("❌ Exception with regular client:", err)
    return { error: err.message }
  }
}
