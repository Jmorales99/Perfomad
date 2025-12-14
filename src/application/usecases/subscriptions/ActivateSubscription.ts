import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"

export class ActivateSubscription {
  constructor(private plaiApi: PlaiApiClient) {}

  async execute(userId: string, email: string, name: string) {
    // 1. Get or create Plai profile
    let plaiUserId: string | null = null

    try {
      const existingProfile = await this.plaiApi.getProfile(email)
      if (existingProfile) {
        plaiUserId = existingProfile.id
      }
    } catch (error) {
      // Profile doesn't exist, will create it
    }

    // 2. Create Plai profile if it doesn't exist
    if (!plaiUserId) {
      plaiUserId = await this.plaiApi.createProfile(email, name)
    }

    // 3. Activate subscription in your database
    const startDate = new Date().toISOString()
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        has_active_subscription: true,
        plai_user_id: plaiUserId,
        subscription_start: startDate,
        subscription_expires: expiryDate,
      })
      .eq("id", userId)

    if (error) {
      throw new Error(`Error activating subscription: ${error.message}`)
    }

    return {
      plai_user_id: plaiUserId,
      subscription_start: startDate,
      expires_at: expiryDate,
    }
  }
}
