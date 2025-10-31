import { ImagesRepository } from '@/domain/repositories/ImagesRepository'

export class UploadImage {
  constructor(private readonly repo: ImagesRepository) {}

  async execute(userId: string, filename: string) {
    if (!filename) throw new Error('Debe enviarse el nombre del archivo.')
    return await this.repo.generateSignedUploadUrl(userId, filename)
  }
}
