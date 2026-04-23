import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import type { Client, ClientsRepository } from "@/domain/repositories/ClientsRepository"

export class SupabaseClientsRepository implements ClientsRepository {
  async listByUser(userId: string): Promise<Client[]> {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, user_id, name, description, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) throw error
    return (data ?? []) as Client[]
  }

  async getById(userId: string, clientId: string): Promise<Client | null> {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, user_id, name, description, created_at")
      .eq("id", clientId)
      .eq("user_id", userId)
      .maybeSingle()

    if (error) throw error
    return data as Client | null
  }

  async create(userId: string, name: string, description?: string | null): Promise<Client> {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({
        user_id: userId,
        name: name.trim(),
        description: description?.trim() || null,
      })
      .select()
      .single()

    if (error) throw error
    return data as Client
  }

  async upsertDefault(userId: string): Promise<Client> {
    // ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name (no-op) → always returns the row
    const { data, error } = await supabaseAdmin
      .from("clients")
      .upsert(
        { user_id: userId, name: "Default", description: null },
        { onConflict: "user_id,name" }
      )
      .select("id, user_id, name, description, created_at")
      .single()

    if (error) throw error
    return data as Client
  }

  async countByUser(userId: string): Promise<number> {
    const { count, error } = await supabaseAdmin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)

    if (error) throw error
    return count ?? 0
  }

  async deleteById(userId: string, clientId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("clients")
      .delete()
      .eq("id", clientId)
      .eq("user_id", userId)

    if (error) throw error
  }
}
