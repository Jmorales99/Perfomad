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
}
