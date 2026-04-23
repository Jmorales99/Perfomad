import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"

export class ActivateSubscription {
  async execute(userId: string, email: string, name: string) {
    // Activate subscription in database
    // No longer creates Plai profile - users connect platforms directly
    const startDate = new Date().toISOString()
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        has_active_subscription: true,
        subscription_start: startDate,
        subscription_expires: expiryDate,
      })
      .eq("id", userId)

    if (error) {
      throw new Error(`Error activating subscription: ${error.message}`)
    }

    return {
      subscription_start: startDate,
      expires_at: expiryDate,
    }
  }
}
