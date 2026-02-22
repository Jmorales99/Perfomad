import type { Client, ClientsRepository } from "@/domain/repositories/ClientsRepository"

export class GetClientById {
  constructor(private clientsRepo: ClientsRepository) {}

  async execute(userId: string, clientId: string): Promise<Client | null> {
    return this.clientsRepo.getById(userId, clientId)
  }
}
