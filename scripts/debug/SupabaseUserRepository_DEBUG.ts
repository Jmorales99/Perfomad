// DEBUG: Test if Supabase keys are working
// Run from repo root: npx tsx scripts/debug/SupabaseUserRepository_DEBUG.ts
import { supabaseAdmin, supabaseClient } from "../../src/infrastructure/db/supabaseClient.js"
import { env } from "../../src/config/env.js"

export async function debugSupabaseKeys() {
  console.log("🔍 DEBUG: Testing Supabase configuration...")
  console.log("📍 SUPABASE_URL:", env.SUPABASE_URL)
  console.log("📍 SUPABASE_PUBLISHABLE_KEY length:", env.SUPABASE_PUBLISHABLE_KEY?.length || 0)
  console.log("📍 SUPABASE_SECRET_KEY length:", env.SUPABASE_SECRET_KEY?.length || 0)

  // Test 1: Can we query profiles?
  console.log("\n🧪 Test 1: Querying profiles table...")
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .limit(1)

  if (profilesError) {
    console.error("❌ Cannot query profiles:", profilesError.message)
  } else {
    console.log("✅ Can query profiles:", profiles?.length || 0, "found")
  }

  // Test 2: Can we query auth.users through admin?
  console.log("\n🧪 Test 2: Testing admin client...")
  try {
    const { data: users, error: usersError } = await supabaseAdmin.auth.admin.listUsers()
    if (usersError) {
      console.error("❌ Admin client cannot list users:", usersError.message)
      console.error("❌ This means SECRET KEY is wrong or doesn't have admin permissions")
    } else {
      console.log("✅ Admin client works! Found", users?.users?.length || 0, "users")
    }
  } catch (err: any) {
    console.error("❌ Exception testing admin client:", err.message)
  }

  // Test 3: Can regular client sign up?
  console.log("\n🧪 Test 3: Testing regular client (signUp)...")
  try {
    const testEmail = `test-${Date.now()}@example.com`
    const { data, error } = await supabaseClient.auth.signUp({
      email: testEmail,
      password: "testpassword123",
    })

    if (error) {
      console.error("❌ Regular client signUp failed:", error.message)
      console.error("❌ Error code:", error.status)
    } else {
      console.log("✅ Regular client signUp works!")
      console.log("✅ Created user:", data.user?.id)
    }
  } catch (err: any) {
    console.error("❌ Exception testing regular client:", err.message)
  }
}
