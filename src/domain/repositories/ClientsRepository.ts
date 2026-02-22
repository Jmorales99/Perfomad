/**
 * Domain interface for internal clients (empresas internas per user).
 */
export interface Client {
  id: string
  user_id: string
  name: string
  description: string | null
  created_at: string
}

export interface ClientsRepository {
  listByUser(userId: string): Promise<Client[]>
  getById(userId: string, clientId: string): Promise<Client | null>
  create(userId: string, name: string, description?: string | null): Promise<Client>
}
