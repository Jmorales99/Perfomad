import type { Client, ClientsRepository } from "@/domain/repositories/ClientsRepository"

/**
 * Lists a user's clients and guarantees at least one exists.
 * If the user has no clients, "Default" is created (idempotent via upsert)
 * before returning the final list.
 */
export class ListClientsWithDefault {
  constructor(private clientsRepo: ClientsRepository) {}

  async execute(userId: string): Promise<Client[]> {
    const clients = await this.clientsRepo.listByUser(userId)
    if (clients.length > 0) return clients

    await this.clientsRepo.upsertDefault(userId)
    return this.clientsRepo.listByUser(userId)
  }
}
