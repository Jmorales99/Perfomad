import type { Client, ClientsRepository } from "@/domain/repositories/ClientsRepository"

export class ListClients {
  constructor(private clientsRepo: ClientsRepository) {}

  async execute(userId: string): Promise<Client[]> {
    return this.clientsRepo.listByUser(userId)
  }
}
