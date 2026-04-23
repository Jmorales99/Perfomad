// TEST: Verify Supabase connection works
// Run from repo root: npx tsx scripts/debug/SupabaseUserRepository_TEST_CONNECTION.ts
import { supabaseAdmin, supabaseClient } from "../../src/infrastructure/db/supabaseClient.js"

export async function testSupabaseConnection() {
  console.log("🧪 Testing Supabase connection...")

  // Test 1: Try querying profiles table
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .limit(1)

    if (error) {
      console.error("❌ Error querying profiles:", error)
    } else {
      console.log("✅ Can query profiles table")
    }
  } catch (err) {
    console.error("❌ Exception querying profiles:", err)
  }

  // Test 2: Try using regular client signUp instead of admin
  try {
    console.log("🧪 Testing regular client signUp...")
    const { data, error } = await supabaseClient.auth.signUp({
      email: "test@example.com",
      password: "testpassword123",
    })

    if (error) {
      console.error("❌ Error with regular client:", error)
    } else {
      console.log("✅ Regular client works!")
    }
  } catch (err) {
    console.error("❌ Exception with regular client:", err)
  }
}
