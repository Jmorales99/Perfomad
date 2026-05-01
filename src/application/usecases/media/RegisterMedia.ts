import { MediaRepository, MediaType } from '@/domain/repositories/MediaRepository.js'

export class RegisterMedia {
  constructor(private readonly repo: MediaRepository) {}

  async execute(
    userId: string,
    clientId: string,
    storagePath: string,
    filename: string,
    mediaType: MediaType,
    fileSizeBytes?: number
  ) {
    if (!storagePath) throw new Error('Debe enviarse el storage path del archivo.')
    if (!clientId) throw new Error('Debe especificarse el cliente (marca).')
    return await this.repo.registerMedia(userId, clientId, storagePath, filename, mediaType, fileSizeBytes)
  }
}
