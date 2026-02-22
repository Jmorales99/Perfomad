import type { Client, ClientsRepository } from "@/domain/repositories/ClientsRepository"

export class CreateClient {
  constructor(private clientsRepo: ClientsRepository) {}

  async execute(userId: string, name: string, description?: string | null): Promise<Client> {
    const trimmed = name?.trim()
    if (!trimmed || trimmed.length === 0) {
      throw new Error("name is required and cannot be empty")
    }
    return this.clientsRepo.create(userId, trimmed, description?.trim() || null)
  }
}
