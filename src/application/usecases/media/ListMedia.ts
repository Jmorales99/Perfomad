import { MediaRepository } from '@/domain/repositories/MediaRepository.js'

export class ListMedia {
  constructor(private readonly repo: MediaRepository) {}

  async execute(userId: string, clientId: string) {
    if (!clientId) throw new Error('Debe especificarse el cliente (marca).')
    return await this.repo.listClientMedia(userId, clientId)
  }
}
