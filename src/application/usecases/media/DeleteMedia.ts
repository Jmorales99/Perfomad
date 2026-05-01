import { MediaRepository } from '@/domain/repositories/MediaRepository.js'

export class DeleteMedia {
  constructor(private readonly repo: MediaRepository) {}

  async execute(userId: string, clientId: string, mediaId: string) {
    if (!mediaId) throw new Error('Debe especificarse el ID del archivo a eliminar.')
    if (!clientId) throw new Error('Debe especificarse el cliente (marca).')
    return await this.repo.deleteMedia(userId, clientId, mediaId)
  }
}
