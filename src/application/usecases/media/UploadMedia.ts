import { MediaRepository, MediaType } from '@/domain/repositories/MediaRepository.js'

export class UploadMedia {
  constructor(private readonly repo: MediaRepository) {}

  async execute(userId: string, clientId: string, filename: string, mediaType: MediaType) {
    if (!filename) throw new Error('Debe enviarse el nombre del archivo.')
    if (!clientId) throw new Error('Debe especificarse el cliente (marca).')
    return await this.repo.generateSignedUploadUrl(userId, clientId, filename, mediaType)
  }
}
