import type { ClientsRepository } from "@/domain/repositories/ClientsRepository"

export class ClientNotFoundError extends Error {
  constructor() {
    super("Client not found")
    this.name = "ClientNotFoundError"
  }
}

export class LastClientDeletionForbiddenError extends Error {
  constructor() {
    super("Cannot delete the last brand")
    this.name = "LastClientDeletionForbiddenError"
  }
}

/**
 * Deletes a client owned by the user.
 * - Throws ClientNotFoundError if the client does not exist or does not belong to the user.
 * - Throws LastClientDeletionForbiddenError if this is the user's only client.
 */
export class DeleteClient {
  constructor(private clientsRepo: ClientsRepository) {}

  async execute(userId: string, clientId: string): Promise<void> {
    const client = await this.clientsRepo.getById(userId, clientId)
    if (!client) throw new ClientNotFoundError()

    const count = await this.clientsRepo.countByUser(userId)
    if (count <= 1) throw new LastClientDeletionForbiddenError()

    await this.clientsRepo.deleteById(userId, clientId)
  }
}
